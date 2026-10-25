const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');

const { resolveIntent } = require('../agent/intentResolver');
const { executeTool } = require('../agent/toolExecutor');
const { resolveUserCategory } = require('../agent/categoryResolver');
const { resolveNavigation } = require('../agent/navigationRegistry');

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
      const outcome = await executeTool(confirmedAction.toolName, confirmedAction.params, context);
      return res.json({
        response: outcome.message || 'Action executed successfully.',
        intent: outcome.intent || `${confirmedAction.toolName}.executed`,
        success: outcome.success !== false,
        verifiedData: outcome.verifiedData || outcome.data,
        form: outcome.verifiedData ? { ...outcome.verifiedData, saved: true, isComplete: true } : undefined,
        latencyMs: Date.now() - startTime,
      });
    }

    // 2. Structured Intent Resolution (Groq LLM tool calling with fallback engine)
    const resolved = await resolveIntent(message, history, { mode });
    const { toolName, params, isInferred } = resolved;

    // 3. For Create Expense: Prepare card with verified category ID
    if (toolName === 'create_expense') {
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
        });
      }

      const preparedExpense = {
        amount,
        category: catRes.categoryName,
        categoryId: catRes.categoryId,
        paymentMethod: params.paymentMethod || 'UPI',
        date: params.date ? new Date(params.date).toISOString() : new Date().toISOString(),
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
        latencyMs: Date.now() - startTime,
      });
    }

    // 4. For other tools (Navigation, Read-only queries, Splits, Tiffin, Undo, Delete)
    const outcome = await executeTool(toolName, params, context);

    return res.json({
      response: outcome.message || 'Processed your request.',
      intent: outcome.intent || toolName,
      success: outcome.success !== false,
      verifiedData: outcome.verifiedData,
      navigationAction: outcome.navigationAction || null,
      clarification: outcome.clarification || null,
      pendingAction: outcome.pendingAction || null,
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

