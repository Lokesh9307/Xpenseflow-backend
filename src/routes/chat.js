const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');

const { prepareAgentRequest, executeAgentPlan } = require('../agent/agentOrchestrator');
const { planActions } = require('../agent/actionPlanner');
const { authorizeAction } = require('../agent/policyEngine');
const { resolveUserCategory } = require('../agent/categoryResolver');
const { parseDateParam } = require('../agent/toolExecutor');

// POST /api/chat
router.post('/', auth, async (req, res) => {
  const startTime = Date.now();
  try {
    const userId = req.user.id;
    const { message, mode = 'agentic', history = [], requestId, confirmedAction } = req.body;

    if (!message && !confirmedAction) {
      return res.status(400).json({ message: 'Message or confirmedAction is required' });
    }

    const context = {
      userId,
      rawMessage: message || '',
      requestId: requestId || `req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      mode,
    };

    // 1. Direct Confirmed Action Execution (e.g. user tapped "Confirm & Save" on mobile card)
    if (confirmedAction && confirmedAction.toolName) {
      const confirmedParams = confirmedAction.params || {};
      const sanitizedAction = confirmedAction.toolName === 'create_expense'
        ? {
            toolName: 'create_expense',
            params: {
              amount: confirmedParams.amount,
              category: confirmedParams.category,
              title: confirmedParams.title,
              paymentMethod: confirmedParams.paymentMethod,
              date: confirmedParams.date,
              notes: confirmedParams.notes,
              isExplicitDate: confirmedParams.isExplicitDate,
            },
          }
        : confirmedAction;
      const plan = planActions([sanitizedAction], '');
      if (!plan.valid) {
        return res.status(400).json({ success: false, response: plan.reason });
      }
      const result = await executeAgentPlan(plan, context);
      const outcome = result.results[0]?.outcome;
      return res.json({
        response: outcome?.message || result.reason || 'The action could not be verified.',
        intent: outcome?.intent || `${sanitizedAction.toolName}.executed`,
        success: result.success,
        verifiedData: outcome?.verifiedData || outcome?.data,
        form: outcome?.verifiedData ? { ...outcome.verifiedData, saved: true, isComplete: true } : undefined,
        latencyMs: Date.now() - startTime,
      });
    }

    // Route the request through trusted skills, validated context, and a typed action plan.
    const prepared = await prepareAgentRequest({ userId, message, history, mode });
    if (!prepared.plan.valid) {
      return res.json({
        response: prepared.plan.reason,
        intent: 'clarification.required',
        success: false,
        clarification: {
          question: 'Could you clarify what you want me to do?',
          options: [],
          missingField: 'request',
        },
        skillsLoaded: prepared.skillIds,
        latencyMs: Date.now() - startTime,
      });
    }
    const actions = prepared.plan.actions;
    const firstAction = actions[0];
    const { toolName, params } = firstAction;

    if (actions.length > 1 && actions.some((action) => action.toolName === 'create_expense')) {
      return res.json({
        response: 'I can prepare one expense for confirmation at a time. Please send the expense separately so it can be reviewed before saving.',
        intent: 'clarification.required',
        success: false,
        clarification: {
          question: 'Would you like to handle the expense first, or continue with the other requested actions?',
          options: ['Handle expense first', 'Continue with other actions'],
          missingField: 'actionOrder',
        },
        skillsLoaded: prepared.skillIds,
        latencyMs: Date.now() - startTime,
      });
    }

    for (const action of actions) {
      const authorization = authorizeAction(action, context);
      if (!authorization.allowed) {
        return res.json({
          response: authorization.reason,
          intent: 'action.rejected',
          success: false,
          skillsLoaded: prepared.skillIds,
          latencyMs: Date.now() - startTime,
        });
      }
    }

    // 3. For Create Expense: Prepare card with verified category ID
    if (toolName === 'create_expense' && actions.length === 1) {
      const amount = parseFloat(params.amount);
      if (isNaN(amount) || amount <= 0) {
        return res.json({
          response: 'What was the amount spent in ₹?',
          intent: 'clarification.required',
          clarification: {
            question: 'Please specify the amount spent:',
            options: ['₹100', '₹250', '₹500', '₹1000'],
            missingField: 'amount',
          },
          skillsLoaded: prepared.skillIds,
          latencyMs: Date.now() - startTime,
        });
      }

      // Deterministic category resolution using authenticated user's real categories
      const catRes = await resolveUserCategory(userId, params.category || '', message);

      if (!catRes.resolved) {
        return res.json({
          response: catRes.reason || `I noted ₹${amount}. Which category does this belong to?`,
          intent: 'clarification.required',
          clarification: {
            question: catRes.reason || 'Which category does this expense belong to?',
            options: (catRes.candidates && catRes.candidates.length > 0)
              ? catRes.candidates.slice(0, 6)
              : ['Food & Dining', 'Shopping', 'Travel & Commute', 'Bills & Utilities', 'Entertainment', 'Others'],
            missingField: 'category',
          },
          pendingAction: {
            toolName: 'create_expense',
            params: {
              amount,
              title: params.title || '',
              paymentMethod: params.paymentMethod || 'UPI',
              date: params.date || new Date().toISOString(),
            },
          },
          skillsLoaded: prepared.skillIds,
          latencyMs: Date.now() - startTime,
        });
      }

      const expenseDate = parseDateParam(params.date);
      if (Number.isNaN(expenseDate.getTime())) {
        return res.json({
          response: 'I could not understand the expense date. What date should I use?',
          intent: 'clarification.required',
          success: false,
          clarification: {
            question: 'What date was this expense made?',
            options: [],
            missingField: 'date',
          },
          skillsLoaded: prepared.skillIds,
          latencyMs: Date.now() - startTime,
        });
      }

      const preparedExpense = {
        amount,
        category: catRes.categoryName,
        categoryId: catRes.categoryId,
        paymentMethod: params.paymentMethod || 'UPI',
        date: expenseDate.toISOString(),
        title: params.title || `${catRes.categoryName} expense`,
        isComplete: true,
        saved: false,
      };

      const responseText = `I've prepared an expense of ₹${amount} for "${catRes.categoryName}" via ${preparedExpense.paymentMethod}. Tap below to save it:`;

      return res.json({
        response: responseText,
        intent: 'expense.create',
        form: preparedExpense,
        actionCard: {
          type: 'expense_preview',
          data: preparedExpense,
        },
        pendingAction: {
          toolName: 'create_expense',
          params: preparedExpense,
        },
        skillsLoaded: prepared.skillIds,
        latencyMs: Date.now() - startTime,
      });
    }

    // Execute a bounded plan in order and stop on the first failed prerequisite.
    const execution = await executeAgentPlan(prepared.plan, context);
    const outcomes = execution.results.map(({ outcome }) => outcome);
    const outcome = outcomes[outcomes.length - 1] || {};
    const responseText = outcomes
      .map((result) => result.message)
      .filter(Boolean)
      .join('\n');

    return res.json({
      response: responseText || execution.reason || 'Processed your request.',
      intent: outcome.intent || toolName,
      success: execution.success,
      verifiedData: outcome.verifiedData,
      navigationAction: outcome.navigationAction || null,
      clarification: outcome.clarification || null,
      pendingAction: outcome.pendingAction || null,
      actionResults: outcomes.length > 1 ? outcomes : undefined,
      skillsLoaded: prepared.skillIds,
      form: outcome.verifiedData && toolName === 'create_expense'
        ? { ...outcome.verifiedData, saved: true, isComplete: true }
        : undefined,
      latencyMs: Date.now() - startTime,
    });
  } catch (err) {
    console.error('[POST /api/chat] Error:', err);
    return res.status(500).json({
      response: 'An error occurred while processing your request. Please try again.',
      error: err.message || 'Server error',
      success: false,
    });
  }
});

module.exports = router;
