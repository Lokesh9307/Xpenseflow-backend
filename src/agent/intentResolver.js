/**
 * Structured Intent Resolver
 *
 * Uses a tool-calling model when configured and a deterministic, grounded
 * parser as the production fallback. All model output is validated against the
 * registered tool schemas before it can reach the executor.
 */

const { AGENT_TOOLS } = require('./toolDefinitions');
const { validateRegisteredToolCall } = require('./toolRegistry');
const { parseDeterministicIntent } = require('./deterministicIntent');

const SYSTEM_PROMPT = `You are ExpenseBot, the production financial Copilot inside the XpenseFlow mobile app.
Your job is to understand the user's whole request and select the correct registered tool.

Rules:
1. NEVER invent balances, totals, transactions, dates, or category IDs. Financial numbers must come from a tool result.
2. ALWAYS use a tool for a financial question or mutation. Do not answer account-data questions from memory.
3. Distinguish a statement ("I spent ₹400 on petrol") from a question ("How much did I spend on petrol?"). Statements may prepare an expense; questions must query data.
4. Extract only the transaction amount. Never treat a year (2025), date, time, count (2 coffees), percentage, or balance as the amount. Ask for clarification when two different amounts could be the spent amount.
5. Support only INR (₹) for expenses. If the currency is unclear or foreign, ask for clarification.
6. For expense creation, extract amount, category phrase, merchant/title, payment method, and date. Set isExplicitDate=true only when the user stated a date. Default payment to UPI.
7. Resolve relative periods using the trusted today value: "today"/"yesterday" -> startDate+endDate, "this month"/"last month" -> YYYY-MM.
8. For "top category" or "what is eating my budget" use focus=top_category. For "biggest/largest expense" use focus=largest_expense. For month-over-month comparisons use comparePreviousMonth=true. When no period is stated, use the current month instead of asking for a period.
9. If the user says "card" without saying debit, use Credit Card. "Cash" is Cash; default is UPI.
10. For navigation, call navigate_app only with a screenTarget from the trusted navigation list. "Latest/recent expenses" is a query, not navigation.
11. If the request is missing a required field (amount, category, target record), call request_clarification with useful quick-reply options.
12. Multiple explicitly requested actions may be returned in dependency order (maximum 5). Never combine an expense creation with unrelated mutations.
13. Never propose a mutation for a negated, hypothetical, or quoted instruction.
14. Keep responses short, specific, and friendly. No markdown tables.`;

const FINANCIAL_OR_ACTION =
  /\b(expense|expenses|spent|spend|budget|balance|transaction|transactions|tiffin|split|owe|owed|analytics|report|income|category|refund|delete|undo|update|change)\b/i;

/**
 * Validates a tool call against the runtime registry.
 */
function validateToolCall(toolName, params) {
  return validateRegisteredToolCall(toolName, params);
}

/**
 * Deterministic parser used when no model key is configured, the model times
 * out, or the model returns unsafe/unvalidated output.
 */
function parseDeterministicFallback(message) {
  return parseDeterministicIntent(message);
}

/**
 * A few phrasings have one safe, unambiguous interpretation. Resolve them
 * deterministically before the model so latency stays low and repeated
 * requests behave identically even when the model is flaky.
 */
function highConfidenceIntent(message) {
  const parsed = parseDeterministicFallback(message);
  const lower = String(message || '').toLowerCase();

  if (
    /^\s*(?:open|show|go to|take me to|navigate to)\b/.test(lower) &&
    parsed.toolName === 'navigate_app'
  ) {
    return parsed;
  }
  if (
    /\b(?:latest|recent|last few)\b/.test(lower) &&
    /\b(?:expenses?|transactions?|spending|purchases?)\b/.test(lower) &&
    parsed.toolName === 'query_expenses'
  ) {
    return parsed;
  }
  if (
    /\b(?:eating|top category|biggest category|which category|most of my (?:budget|money))\b/.test(lower) &&
    parsed.toolName === 'query_expenses'
  ) {
    return parsed;
  }
  if (
    /^\s*(?:put|charge|swipe)\b/.test(lower) &&
    parsed.toolName === 'create_expense'
  ) {
    return parsed;
  }
  return null;
}

/**
 * The model is allowed to pick the category, but it should not lose a category
 * the deterministic parser clearly recognized (for example "tea" -> Food).
 */
function normalizeModelActions(actions, message) {
  const guidance = parseDeterministicFallback(message);
  if (guidance.toolName !== 'create_expense' || guidance.params.category === 'Others') {
    return actions;
  }

  return actions.map((action) => {
    if (action.toolName !== 'create_expense') return action;
    const params = action.params || {};
    if (params.category && params.category !== 'Others') return action;
    return {
      ...action,
      params: {
        ...params,
        category: guidance.params.category,
        categoryId: undefined,
      },
    };
  });
}

async function resolveIntent(message, history = [], options = {}) {
  const apiKey = process.env.GROQ_API_KEY;
  const model = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

  if (!apiKey) {
    return parseDeterministicFallback(message);
  }

  const confident = highConfidenceIntent(message);
  if (confident) {
    return confident;
  }

  try {
    const formattedHistory = (history || []).slice(-6).map((item) => ({
      role: item.role === 'user' ? 'user' : 'assistant',
      content: typeof item.content === 'string' ? item.content : JSON.stringify(item.content),
    }));
    const contextText = options.trustedContext
      ? `\n\nTrusted application context (do not infer beyond these values):\n${JSON.stringify(options.trustedContext)}`
      : '';
    const skillText = options.skillInstructions
      ? `\n\nFollow only these loaded domain instructions in addition to the global rules:\n${options.skillInstructions}`
      : '';

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    let res;
    try {
      res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'system',
              content: `${SYSTEM_PROMPT}${contextText}${skillText}`,
            },
            ...formattedHistory,
            { role: 'user', content: message },
          ],
          tools: AGENT_TOOLS,
          tool_choice: 'auto',
          temperature: 0.1,
          max_tokens: 450,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!res.ok) {
      console.warn(`[IntentResolver] Groq returned HTTP ${res.status}; using deterministic fallback.`);
      return parseDeterministicFallback(message);
    }

    const data = await res.json();
    const choice = data.choices?.[0];

    if (choice?.message?.tool_calls && choice.message.tool_calls.length > 0) {
      const actions = [];
      for (const toolCall of choice.message.tool_calls) {
        const toolName = toolCall.function?.name;
        let toolArgs;
        try {
          toolArgs = JSON.parse(toolCall.function?.arguments || '{}');
        } catch (error) {
          return {
            toolName: 'request_clarification',
            params: {
              question: 'I could not safely understand that action. Could you rephrase it?',
              options: [],
              missingField: 'request',
            },
            isInferred: false,
          };
        }

        if (!validateToolCall(toolName, toolArgs)) {
          return {
            toolName: 'request_clarification',
            params: {
              question: 'I could not validate the requested action. Please clarify what you want me to do.',
              options: [],
              missingField: 'request',
            },
            isInferred: false,
          };
        }
        actions.push({ toolName, params: toolArgs });
      }

      const normalizedActions = normalizeModelActions(actions, message);
      return {
        ...normalizedActions[0],
        actions: normalizedActions,
        isInferred: false,
        modelReasoning: choice.message?.reasoning || null,
      };
    }

    if (choice?.message?.content) {
      // A free-form model answer about account data is not grounded. Fall back
      // to a tool query instead of showing a potentially invented number.
      if (options.mode !== 'simple' && FINANCIAL_OR_ACTION.test(message)) {
        return parseDeterministicFallback(message);
      }
      return {
        toolName: 'general_answer',
        params: { response: choice.message.content },
        isInferred: false,
      };
    }

    return parseDeterministicFallback(message);
  } catch (error) {
    console.error('[IntentResolver] Call failed, using deterministic fallback:', error.message);
    return parseDeterministicFallback(message);
  }
}

module.exports = {
  resolveIntent,
  parseDeterministicFallback,
  validateToolCall,
};
