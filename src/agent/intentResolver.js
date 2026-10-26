/**
 * Structured Intent Resolver
 * 
 * Interacts with Groq LLM using tool definitions, validates outputs against
 * strict runtime schemas, tracks explicit vs. inferred parameters, and provides
 * a robust deterministic fallback parser for network/provider errors.
 */

const { AGENT_TOOLS } = require('./toolDefinitions');
const { resolveNavigation } = require('./navigationRegistry');
const { validateRegisteredToolCall } = require('./toolRegistry');

const SYSTEM_PROMPT = `You are ExpenseBot, a production-grade, highly reliable AI financial assistant for the XpenseFlow mobile application.
Your goal is to parse user intents accurately and call the appropriate tool.

Rules:
1. NEVER invent or hallucinate financial numbers or balances. Always use tools to query or calculate.
2. For expense creation, always extract the amount, category phrase, and merchant if available.
3. If user states a date explicitly (e.g., "yesterday", "last friday", "on Oct 12"), set isExplicitDate to true. If today is inferred, set isExplicitDate to false.
4. For navigation requests (e.g., "open expenses", "show reports", "take me to tiffin", "where can I logout"), call navigate_app.
5. If crucial information like amount is missing for an expense, use request_clarification.
6. Available primary navigation screens must come from the supplied trusted application context.
7. Available payment methods: UPI, Cash, Credit Card, Debit Card, Net Banking. Default to UPI.`;

/**
 * Validates tool call parameters at runtime.
 */
function validateToolCall(toolName, params) {
  return validateRegisteredToolCall(toolName, params);
}

/**
 * Fallback deterministic rule-based parser when LLM is unavailable or offline.
 */
function parseDeterministicFallback(message) {
  const clean = message.toLowerCase().trim();

  // 1. Navigation checks
  const navMatch = resolveNavigation(clean);
  if (navMatch) {
    return {
      toolName: 'navigate_app',
      params: {
        screenTarget: navMatch.screenId,
        reason: `Open ${navMatch.title}`,
      },
      isInferred: false,
    };
  }

  // 2. Undo check
  if (/\b(undo|revert|cancel last|remove last)\b/i.test(clean)) {
    return {
      toolName: 'undo_last_expense',
      params: {},
      isInferred: false,
    };
  }

  // 3. Amount extraction (if amount is present, it is an expense or split creation)
  const amountMatch = clean.match(/(?:₹|rs\.?|inr)?\s*(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:rs|k)?/i);
  let amount = null;
  if (amountMatch) {
    amount = parseFloat(amountMatch[1].replace(/,/g, ''));
  }

  // 4. Split operations
  if (/\b(split|owe|owed|share bill)\b/i.test(clean)) {
    if (amount && amount > 0 && /\b(create|add|log|bill|spent|paid)\b/i.test(clean)) {
      return {
        toolName: 'create_split',
        params: {
          amount,
          description: clean.replace(/(?:₹|rs\.?|inr)?\s*(\d+(?:,\d+)*(?:\.\d+)?)/i, '').trim() || 'Shared Bill',
        },
        isInferred: false,
      };
    }
    return {
      toolName: 'query_splits',
      params: {},
      isInferred: false,
    };
  }

  // 5. Tiffin operations
  if (/\btiffins?\b/i.test(clean)) {
    if (/\b(how many|bill|total|summary|check|status|count)\b/i.test(clean)) {
      return {
        toolName: 'query_tiffin',
        params: { month: 'this month' },
        isInferred: true,
      };
    }

    let mealType = 'lunch';
    if (/\bdinner\b/i.test(clean)) mealType = 'dinner';
    else if (/\bbreakfast\b/i.test(clean)) mealType = 'breakfast';

    return {
      toolName: 'log_tiffin',
      params: { mealType, date: 'today', count: 1 },
      isInferred: false,
    };
  }

  // 6. Budget checks
  if (/\bbudget\b/i.test(clean)) {
    return {
      toolName: 'query_budget',
      params: { month: 'this month' },
      isInferred: false,
    };
  }

  // 7. Read-only Expense queries (only when NO specific amount is provided)
  if (!amount && /\b(how much|what did i spend|total spending|spending summary|show expenses|list expenses|view expenses|spending)\b/i.test(clean)) {
    let category = undefined;
    if (/food|dining|eat/i.test(clean)) category = 'Food & Dining';
    else if (/travel|petrol|fuel|commute/i.test(clean)) category = 'Travel & Commute';
    else if (/shopping/i.test(clean)) category = 'Shopping';
    else if (/bills|utilities/i.test(clean)) category = 'Bills & Utilities';

    return {
      toolName: 'query_expenses',
      params: { category, month: 'this month' },
      isInferred: true,
    };
  }


  // Explicit vs inferred date
  let date = 'today';
  let isExplicitDate = false;
  if (/\byesterday\b/i.test(clean)) {
    date = 'yesterday';
    isExplicitDate = true;
  } else if (/\bday before yesterday\b/i.test(clean)) {
    date = 'day before yesterday';
    isExplicitDate = true;
  }

  // Payment method
  let paymentMethod = 'UPI';
  if (/\bcash\b/i.test(clean)) paymentMethod = 'Cash';
  else if (/\bcredit\b/i.test(clean)) paymentMethod = 'Credit Card';
  else if (/\bdebit\b/i.test(clean)) paymentMethod = 'Debit Card';

  // Category phrase extraction
  let categoryPhrase = '';
  if (/petrol|fuel|diesel|uber|ola|cab|auto|flight|train/i.test(clean)) {
    categoryPhrase = 'Travel & Commute';
  } else if (/coffee|starbucks|pizza|burger|dinner|lunch|breakfast|food|restaurant|swiggy|zomato/i.test(clean)) {
    categoryPhrase = 'Food & Dining';
  } else if (/grocer|vegetable|milk|blinkit|zepto|instamart/i.test(clean)) {
    categoryPhrase = 'Groceries';
  } else if (/cloth|shirt|zara|shopping|amazon|flipkart/i.test(clean)) {
    categoryPhrase = 'Shopping';
  } else if (/electricity|wifi|rent|bill|recharge/i.test(clean)) {
    categoryPhrase = 'Bills & Utilities';
  } else if (/movie|pvr|cinema|netflix|spotify/i.test(clean)) {
    categoryPhrase = 'Entertainment';
  }

  if (amount && amount > 0) {
    return {
      toolName: 'create_expense',
      params: {
        amount,
        category: categoryPhrase || 'Others',
        paymentMethod,
        date,
        isExplicitDate,
        title: clean.slice(0, 40),
      },
      isInferred: !isExplicitDate,
    };
  }

  // If user mentioned expense intent without amount, ask clarification
  if (/\b(spent|bought|paid|expense|cost)\b/i.test(clean)) {
    return {
      toolName: 'request_clarification',
      params: {
        question: 'How much did you spend?',
        options: ['₹100', '₹250', '₹500', '₹1000'],
        missingField: 'amount',
      },
      isInferred: false,
    };
  }

  // General default answer
  return {
    toolName: 'general_answer',
    params: {
      response: "I'm your XpenseFlow Copilot. You can tell me to log an expense (e.g., 'Spent ₹400 on petrol'), check budgets ('How much budget left?'), log tiffin, or navigate the app ('Show reports').",
    },
    isInferred: false,
  };
}

/**
 * Resolves user message into a structured tool call using Groq or fallback rule engine.
 */
async function resolveIntent(message, history = [], options = {}) {
  const apiKey = process.env.GROQ_API_KEY;
  const model = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

  if (!apiKey) {
    console.warn('[IntentResolver] No GROQ_API_KEY set; using deterministic rule parser.');
    return parseDeterministicFallback(message);
  }

  try {
    const formattedHistory = (history || []).slice(-4).map((h) => ({
      role: h.role === 'user' ? 'user' : 'assistant',
      content: typeof h.content === 'string' ? h.content : JSON.stringify(h.content),
    }));
    const contextText = options.trustedContext
      ? `\n\nTrusted application context (do not infer beyond these values):\n${JSON.stringify(options.trustedContext)}`
      : '';
    const skillText = options.skillInstructions
      ? `\n\nFollow only these loaded domain instructions in addition to the global rules:\n${options.skillInstructions}`
      : '';

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
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
            content: `${SYSTEM_PROMPT}${contextText}${skillText}\n\nInterpret the whole request before acting. If multiple actions are explicitly requested, return tool calls in dependency order. Never execute or propose a mutation for negated, hypothetical, or merely quoted instructions.`,
          },
          ...formattedHistory,
          { role: 'user', content: message },
        ],
        tools: AGENT_TOOLS,
        tool_choice: 'auto',
        temperature: 0.1,
        max_tokens: 350,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      console.warn(`[IntentResolver] Groq returned HTTP ${res.status}; falling back to rule engine.`);
      return parseDeterministicFallback(message);
    }

    const data = await res.json();
    const choice = data.choices?.[0];

    // 1. Tool calls received from model. Validate the complete proposed plan.
    if (choice?.message?.tool_calls && choice.message.tool_calls.length > 0) {
      const actions = [];
      for (const toolCall of choice.message.tool_calls) {
        const toolName = toolCall.function?.name;
        let toolArgs;
        try {
          toolArgs = JSON.parse(toolCall.function?.arguments || '{}');
        } catch (e) {
          console.warn('[IntentResolver] Could not parse tool arguments JSON:', e);
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

      return {
        ...actions[0],
        actions,
        isInferred: false,
        modelReasoning: choice.message?.reasoning || null,
      };
    }

    // 2. Direct Content Response from model
    if (choice?.message?.content) {
      return {
        toolName: 'general_answer',
        params: {
          response: choice.message.content,
        },
        isInferred: false,
      };
    }

    return parseDeterministicFallback(message);
  } catch (err) {
    console.error('[IntentResolver] Call failed, using deterministic fallback:', err.message);
    return parseDeterministicFallback(message);
  }
}

module.exports = {
  resolveIntent,
  parseDeterministicFallback,
  validateToolCall,
};
