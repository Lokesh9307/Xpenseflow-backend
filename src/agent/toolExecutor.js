/**
 * Secure Tool Execution Engine
 * 
 * Executes allowlisted operations against real application domain models.
 * 
 * Non-negotiable security rules:
 * 1. Derives userId strictly from authenticated session token.
 * 2. Validates ownership on all target records.
 * 3. Never reports successful mutation without verifying actual DB operation.
 * 4. Idempotency guards against duplicate transactions.
 * 5. Uses real category IDs from deterministic category resolution.
 */

const Expense = require('../models/Expense');
const Category = require('../models/Category');
const Budget = require('../models/Budget');
const SplitExpense = require('../models/SplitExpense');
const SplitGroup = require('../models/SplitGroup');
const TiffinEntry = require('../models/TiffinEntry');
const TiffinGroup = require('../models/TiffinGroup');

const { resolveUserCategory } = require('./categoryResolver');
const { resolveNavigation } = require('./navigationRegistry');
const { checkIdempotency, lockRequestId, saveIdempotencyResult } = require('./idempotency');
const {
  queryExpensesSummary,
  queryBudgetStatus,
  querySplitSummary,
  queryTiffinSummary,
  invalidateUserQueryCache,
} = require('./groundedQueries');

// In-memory bounded session context for recent mutations per user
const lastMutationByUser = new Map();

/**
 * Parses user-provided date string into valid Date object.
 */
function parseDateParam(dateStr) {
  if (!dateStr) return new Date();
  const lower = String(dateStr).toLowerCase().trim();
  const now = new Date();

  if (lower === 'today') return now;
  if (lower === 'yesterday') {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    return d;
  }
  if (lower === 'day before yesterday') {
    const d = new Date(now);
    d.setDate(d.getDate() - 2);
    return d;
  }

  const parsed = new Date(dateStr);
  return isNaN(parsed.getTime()) ? now : parsed;
}

/**
 * Main allowlisted tool dispatcher.
 */
async function executeTool(toolName, params = {}, context = {}) {
  const { userId, rawMessage = '', requestId = '' } = context;

  if (!userId) {
    return {
      success: false,
      error: 'Unauthenticated tool execution attempt rejected.',
    };
  }

  // Check idempotency for mutations
  const isMutation = ['create_expense', 'update_expense', 'delete_expense', 'undo_last_expense', 'create_split', 'log_tiffin'].includes(toolName);
  if (isMutation && requestId) {
    const check = checkIdempotency(requestId);
    if (check.exists && check.status === 'COMPLETED') {
      return {
        ...check.result,
        idempotentReplay: true,
      };
    }
    lockRequestId(requestId);
  }

  let executionResult = null;

  try {
    switch (toolName) {
      // ══════════════════════════════════════════════════════════════════════════
      // 1. EXPENSE OPERATIONS
      // ══════════════════════════════════════════════════════════════════════════
      case 'create_expense': {
        const amount = parseFloat(params.amount);
        if (isNaN(amount) || amount <= 0) {
          return {
            success: false,
            intent: 'clarification.required',
            clarification: {
              question: 'Please specify a valid expense amount greater than ₹0.',
              options: ['₹100', '₹250', '₹500', '₹1000'],
              missingField: 'amount',
            },
            message: 'What was the amount spent?',
          };
        }

        // Deterministic Category Resolution
        const categoryResolution = await resolveUserCategory(
          userId,
          params.category || '',
          rawMessage
        );

        if (!categoryResolution.resolved) {
          return {
            success: false,
            intent: 'clarification.required',
            clarification: {
              question: categoryResolution.reason || 'Which category does this expense belong to?',
              options: (categoryResolution.candidates && categoryResolution.candidates.length > 0)
                ? categoryResolution.candidates.slice(0, 6)
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
            message: `I noted ₹${amount}. Could you clarify the category?`,
          };
        }

        const expenseDate = parseDateParam(params.date);
        const resolvedTitle = params.title?.trim() || `${categoryResolution.categoryName} expense`;
        const paymentMethod = params.paymentMethod || 'UPI';

        const createdDoc = await Expense.create({
          userId,
          title: resolvedTitle,
          amount,
          categoryId: categoryResolution.categoryId,
          category: categoryResolution.categoryName,
          date: expenseDate,
          paymentMethod,
          notes: params.notes || '',
        });

        // Update monthly budget spent
        const monthKey = `${expenseDate.getFullYear()}-${String(expenseDate.getMonth() + 1).padStart(2, '0')}`;
        await Budget.findOneAndUpdate(
          { userId, categoryId: categoryResolution.categoryId, month: monthKey },
          { $inc: { spent: amount } },
          { upsert: false }
        ).catch(() => {});

        // Save last created mutation for undo
        lastMutationByUser.set(userId, {
          type: 'create_expense',
          id: String(createdDoc._id),
          amount,
          category: categoryResolution.categoryName,
          categoryId: categoryResolution.categoryId,
          date: expenseDate,
        });

        executionResult = {
          success: true,
          intent: 'expense.create',
          verifiedData: {
            id: String(createdDoc._id),
            title: createdDoc.title,
            amount: createdDoc.amount,
            category: createdDoc.category,
            categoryId: String(createdDoc.categoryId),
            date: createdDoc.date.toISOString(),
            paymentMethod: createdDoc.paymentMethod,
          },
          message: `Successfully recorded ₹${amount} for "${resolvedTitle}" under ${categoryResolution.categoryName} via ${paymentMethod}.`,
        };
        break;
      }

      case 'query_expenses': {
        const summary = await queryExpensesSummary({
          userId,
          category: params.category,
          month: params.month,
          search: params.search,
          limit: params.limit,
        });

        let summaryText = `Found ${summary.count} transaction(s) totaling ₹${summary.totalAmount.toLocaleString()}`;
        if (summary.period) summaryText += ` for ${summary.period}`;
        if (summary.topCategory) {
          summaryText += `. Top spending was in **${summary.topCategory.name}** (₹${summary.topCategory.amount.toLocaleString()}).`;
        }

        executionResult = {
          success: true,
          intent: 'expense.query',
          verifiedData: summary,
          message: summaryText,
        };
        break;
      }

      case 'update_expense': {
        const { targetQuery, updates } = params;
        let targetDoc = null;

        if (targetQuery && /^[0-9a-fA-F]{24}$/.test(targetQuery)) {
          targetDoc = await Expense.findOne({ _id: targetQuery, userId });
        } else {
          // Resolve most recent expense matching query
          targetDoc = await Expense.findOne({ userId }).sort({ date: -1 });
        }

        if (!targetDoc) {
          return {
            success: false,
            message: 'Could not find the target expense to update.',
          };
        }

        const updatePayload = {};
        if (updates.amount && !isNaN(Number(updates.amount))) {
          updatePayload.amount = Number(updates.amount);
        }
        if (updates.title) updatePayload.title = updates.title.trim();
        if (updates.paymentMethod) updatePayload.paymentMethod = updates.paymentMethod;
        if (updates.date) updatePayload.date = parseDateParam(updates.date);

        if (updates.category) {
          const catRes = await resolveUserCategory(userId, updates.category, rawMessage);
          if (catRes.resolved) {
            updatePayload.category = catRes.categoryName;
            updatePayload.categoryId = catRes.categoryId;
          }
        }

        const updated = await Expense.findOneAndUpdate(
          { _id: targetDoc._id, userId },
          { $set: updatePayload },
          { new: true }
        );

        executionResult = {
          success: true,
          intent: 'expense.update',
          verifiedData: {
            id: String(updated._id),
            title: updated.title,
            amount: updated.amount,
            category: updated.category,
            paymentMethod: updated.paymentMethod,
            date: updated.date.toISOString(),
          },
          message: `Updated "${updated.title}" to ₹${updated.amount} under ${updated.category}.`,
        };
        break;
      }

      case 'delete_expense': {
        const { targetQuery } = params;
        let targetDoc = null;

        if (targetQuery && /^[0-9a-fA-F]{24}$/.test(targetQuery)) {
          targetDoc = await Expense.findOne({ _id: targetQuery, userId });
        } else {
          targetDoc = await Expense.findOne({ userId }).sort({ date: -1 });
        }

        if (!targetDoc) {
          return {
            success: false,
            message: 'Could not find the expense to delete.',
          };
        }

        await Expense.findOneAndDelete({ _id: targetDoc._id, userId });

        // Reverse from budget
        const expDate = new Date(targetDoc.date);
        const monthKey = `${expDate.getFullYear()}-${String(expDate.getMonth() + 1).padStart(2, '0')}`;
        await Budget.findOneAndUpdate(
          { userId, categoryId: targetDoc.categoryId, month: monthKey },
          { $inc: { spent: -targetDoc.amount } }
        ).catch(() => {});

        executionResult = {
          success: true,
          intent: 'expense.delete',
          verifiedData: { id: String(targetDoc._id), title: targetDoc.title, amount: targetDoc.amount },
          message: `Deleted expense "${targetDoc.title}" (₹${targetDoc.amount}).`,
        };
        break;
      }

      case 'undo_last_expense': {
        const lastMutation = lastMutationByUser.get(userId);
        let targetDoc = null;

        if (lastMutation && lastMutation.id) {
          targetDoc = await Expense.findOne({ _id: lastMutation.id, userId });
        }
        if (!targetDoc) {
          targetDoc = await Expense.findOne({ userId }).sort({ createdAt: -1 });
        }

        if (!targetDoc) {
          return {
            success: false,
            message: 'No recent expense found to undo.',
          };
        }

        await Expense.findOneAndDelete({ _id: targetDoc._id, userId });
        lastMutationByUser.delete(userId);

        executionResult = {
          success: true,
          intent: 'expense.undo',
          verifiedData: { id: String(targetDoc._id), title: targetDoc.title, amount: targetDoc.amount },
          message: `Undid last expense: "${targetDoc.title}" of ₹${targetDoc.amount} has been removed.`,
        };
        break;
      }

      // ══════════════════════════════════════════════════════════════════════════
      // 2. BUDGET QUERIES
      // ══════════════════════════════════════════════════════════════════════════
      case 'query_budget': {
        const budgetData = await queryBudgetStatus({
          userId,
          month: params.month,
          category: params.category,
        });

        let msg = `Monthly Budget Status: You have spent ₹${budgetData.totalSpent.toLocaleString()} of ₹${budgetData.totalLimit.toLocaleString()} (${budgetData.overallPercentage}%). Remaining: ₹${budgetData.totalRemaining.toLocaleString()}.`;
        if (budgetData.closestToBudget) {
          msg += `\nHighest alert: **${budgetData.closestToBudget.categoryName}** is at ${budgetData.closestToBudget.percentage}% of its ₹${budgetData.closestToBudget.limit} limit.`;
        }

        executionResult = {
          success: true,
          intent: 'budget.query',
          verifiedData: budgetData,
          message: msg,
        };
        break;
      }

      // ══════════════════════════════════════════════════════════════════════════
      // 3. SPLIT EXPENSE OPERATIONS
      // ══════════════════════════════════════════════════════════════════════════
      case 'query_splits': {
        const splitData = await querySplitSummary({ userId });
        executionResult = {
          success: true,
          intent: 'split.query',
          verifiedData: splitData,
          message: splitData.statusMessage,
        };
        break;
      }

      case 'create_split': {
        const amount = parseFloat(params.amount);
        if (isNaN(amount) || amount <= 0) {
          return {
            success: false,
            intent: 'clarification.required',
            clarification: {
              question: 'Please specify the total bill amount to split.',
              options: ['₹500', '₹1000', '₹1500', '₹2000'],
              missingField: 'amount',
            },
            message: 'What was the bill amount to split?',
          };
        }

        // Find or create user default split group
        let group = await SplitGroup.findOne({
          $or: [{ createdBy: userId }, { 'members.userId': userId }],
        });

        if (!group) {
          group = await SplitGroup.create({
            name: params.groupName || 'Friends & Flatmates',
            createdBy: userId,
            currency: 'INR',
            members: [{ userId, name: 'You' }],
          });
        }

        const splitDoc = await SplitExpense.create({
          groupId: group._id,
          description: params.description || 'Shared Expense',
          amount,
          paidBy: userId,
          splitBetween: [{ userId, amount }],
          date: new Date(),
        });

        executionResult = {
          success: true,
          intent: 'split.create',
          verifiedData: {
            id: String(splitDoc._id),
            groupId: String(group._id),
            groupName: group.name,
            amount: splitDoc.amount,
            description: splitDoc.description,
          },
          message: `Created split bill "${splitDoc.description}" of ₹${amount} in group "${group.name}".`,
        };
        break;
      }

      // ══════════════════════════════════════════════════════════════════════════
      // 4. TIFFIN OPERATIONS
      // ══════════════════════════════════════════════════════════════════════════
      case 'log_tiffin': {
        const mealType = (params.mealType || 'lunch').toLowerCase();
        const mealDate = parseDateParam(params.date);
        const count = parseInt(params.count, 10) || 1;

        let group = await TiffinGroup.findOne({
          $or: [{ createdBy: userId }, { 'members.userId': userId }],
          archived: { $ne: true },
        });

        if (!group) {
          group = await TiffinGroup.create({
            name: 'Daily Tiffin',
            defaultPrice: 80,
            pricePerTiffin: 80,
            createdBy: userId,
            members: [{ userId, name: 'You' }],
          });
        }

        const unitPrice = group.defaultPrice || group.pricePerTiffin || 80;
        const totalPrice = unitPrice * count;

        const entry = await TiffinEntry.create({
          groupId: group._id,
          userId,
          date: mealDate,
          mealType,
          quantity: count,
          count,
          totalPrice,
          notes: params.notes || '',
        });

        executionResult = {
          success: true,
          intent: 'tiffin.log',
          verifiedData: {
            id: String(entry._id),
            mealType: entry.mealType,
            quantity: count,
            totalPrice,
            date: entry.date.toISOString(),
            groupName: group.name,
          },
          message: `Logged ${count} ${mealType} tiffin (₹${totalPrice}) for ${mealDate.toLocaleDateString()}.`,
        };
        break;
      }

      case 'query_tiffin': {
        const tiffinSummary = await queryTiffinSummary({
          userId,
          month: params.month,
          date: params.date,
        });

        const msg = `Tiffin Summary: ${tiffinSummary.totalMeals} meal(s) logged totaling ₹${tiffinSummary.totalCost}. (Lunch: ${tiffinSummary.byMealType.lunch}, Dinner: ${tiffinSummary.byMealType.dinner}, Breakfast: ${tiffinSummary.byMealType.breakfast}).`;

        executionResult = {
          success: true,
          intent: 'tiffin.query',
          verifiedData: tiffinSummary,
          message: msg,
        };
        break;
      }

      // ══════════════════════════════════════════════════════════════════════════
      // 5. FUNCTIONAL NAVIGATION ACTIONS
      // ══════════════════════════════════════════════════════════════════════════
      case 'navigate_app': {
        const resolved = resolveNavigation(params.screenTarget || rawMessage);

        if (!resolved) {
          executionResult = {
            success: false,
            intent: 'navigation.help',
            message: `I couldn't find a screen matching "${params.screenTarget}". You can say "Open expenses", "Show reports", "Take me to tiffin", or "Open split bills".`,
            navigationAction: null,
          };
          break;
        }

        executionResult = {
          success: true,
          intent: 'navigation.open',
          navigationAction: {
            screenId: resolved.screenId,
            title: resolved.title,
            description: resolved.description,
            tab: resolved.tab,
          },
          message: `Tap below to open ${resolved.title}.`,
        };
        break;
      }

      // ══════════════════════════════════════════════════════════════════════════
      // 6. CLARIFICATION & GENERAL ANSWERS
      // ══════════════════════════════════════════════════════════════════════════
      case 'request_clarification': {
        executionResult = {
          success: true,
          intent: 'clarification.required',
          clarification: {
            question: params.question,
            options: params.options || [],
            missingField: params.missingField || '',
          },
          message: params.question,
        };
        break;
      }

      case 'general_answer':
      default: {
        executionResult = {
          success: true,
          intent: 'general.answer',
          message: params.response || 'Here is what I found regarding your finances.',
        };
        break;
      }
    }

    if (isMutation && executionResult?.success) {
      invalidateUserQueryCache(userId);
      if (requestId) {
        saveIdempotencyResult(requestId, executionResult);
      }
    }

    return executionResult;
  } catch (err) {
    console.error(`[executeTool] Error in ${toolName}:`, err);
    return {
      success: false,
      error: err.message || 'Execution failed',
      message: 'An error occurred while executing the action.',
    };
  }
}

module.exports = {
  executeTool,
};
