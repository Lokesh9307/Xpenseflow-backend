const Expense = require('../models/Expense');
const TiffinEntry = require('../models/TiffinEntry');
const SplitExpense = require('../models/SplitExpense');

async function verifyToolResult(toolName, outcome, userId) {
  if (!outcome || outcome.success !== true) return { verified: false, outcome };
  const id = outcome.verifiedData?.id;
  const persistedMutationTools = new Set([
    'create_expense',
    'update_expense',
    'delete_expense',
    'undo_last_expense',
    'create_split',
    'log_tiffin',
  ]);
  if (persistedMutationTools.has(toolName) && !id) {
    return { verified: false, reason: 'The operation returned no record ID to verify.' };
  }

  if (['create_expense', 'update_expense'].includes(toolName) && id) {
    const record = await Expense.findOne({ _id: id, userId }).lean();
    if (!record) return { verified: false, reason: 'Expense was not found after the operation.' };
    return {
      verified: true,
      verifiedData: {
        ...outcome.verifiedData,
        id: String(record._id),
        amount: record.amount,
        category: record.category,
        title: record.title,
        date: record.date?.toISOString?.() || record.date,
      },
    };
  }

  if (['delete_expense', 'undo_last_expense'].includes(toolName) && id) {
    const record = await Expense.findOne({ _id: id, userId }).lean();
    if (record) return { verified: false, reason: 'Expense still exists after the delete operation.' };
    return { verified: true, verifiedData: outcome.verifiedData };
  }

  if (toolName === 'create_split' && id) {
    const record = await SplitExpense.findOne({ _id: id, paidBy: userId }).lean();
    if (!record) return { verified: false, reason: 'Created split expense was not found after save.' };
    return {
      verified: true,
      verifiedData: {
        ...outcome.verifiedData,
        id: String(record._id),
        amount: record.amount,
        description: record.description,
      },
    };
  }

  if (toolName === 'log_tiffin' && id) {
    const record = await TiffinEntry.findOne({ _id: id, userId }).lean();
    if (!record) return { verified: false, reason: 'Saved Tiffin entry was not found after write.' };
    return {
      verified: true,
      verifiedData: {
        ...outcome.verifiedData,
        id: String(record._id),
        mealType: record.mealType,
        quantity: record.quantity ?? record.count,
        totalPrice: record.totalPrice ?? record.totalCost,
        date: record.date?.toISOString?.() || record.date,
      },
    };
  }

  return { verified: true, verifiedData: outcome.verifiedData };
}

module.exports = { verifyToolResult };
