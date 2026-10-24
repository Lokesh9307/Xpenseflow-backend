const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const RecurringExpense = require('../models/RecurringExpense');
const Expense = require('../models/Expense');

function getNextDueDate(fromDate, frequency) {
  const d = new Date(fromDate);
  switch (frequency) {
    case 'daily':
      d.setDate(d.getDate() + 1);
      break;
    case 'weekly':
      d.setDate(d.getDate() + 7);
      break;
    case 'yearly':
      d.setFullYear(d.getFullYear() + 1);
      break;
    case 'monthly':
    default:
      d.setMonth(d.getMonth() + 1);
      break;
  }
  return d;
}

// Automatically process any active recurring expenses that are due
async function autoProcessRecurringExpenses(userId) {
  try {
    const now = new Date();
    const activeList = await RecurringExpense.find({ userId, active: true });

    for (const item of activeList) {
      let nextDue = item.nextDueDate ? new Date(item.nextDueDate) : new Date(item.startDate);

      if (nextDue <= now) {
        // Prevent duplicate creation for the same day
        const startOfDay = new Date(nextDue);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(nextDue);
        endOfDay.setHours(23, 59, 59, 999);

        const existing = await Expense.findOne({
          userId,
          recurringId: item._id,
          date: { $gte: startOfDay, $lte: endOfDay },
        });

        if (!existing) {
          await Expense.create({
            userId,
            title: item.title,
            amount: item.amount,
            category: item.category || 'Subscriptions',
            categoryId: item.categoryId,
            date: nextDue,
            paymentMethod: 'Auto-Debit',
            notes: `Auto-generated subscription for ${item.title}`,
            isRecurring: true,
            recurringId: item._id,
          });
        }

        // Advance nextDueDate to future
        let updatedNext = getNextDueDate(nextDue, item.frequency);
        while (updatedNext <= now) {
          updatedNext = getNextDueDate(updatedNext, item.frequency);
        }
        item.nextDueDate = updatedNext;
        item.lastProcessedDate = now;
        await item.save();
      }
    }
  } catch (err) {
    console.error('autoProcessRecurringExpenses error:', err);
  }
}

// GET /api/recurring
router.get('/', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    // Auto process any due recurring obligations first
    await autoProcessRecurringExpenses(userId);

    const list = await RecurringExpense.find({ userId }).sort({ createdAt: -1 });
    return res.json(list);
  } catch (err) {
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

// POST /api/recurring
router.post('/', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { title, amount, category, categoryId, frequency, startDate, active } = req.body;

    if (!title || !amount) {
      return res.status(400).json({ message: 'Title and amount are required' });
    }

    const start = startDate ? new Date(startDate) : new Date();
    const freq = frequency || 'monthly';
    const nextDue = getNextDueDate(start, freq);

    const item = await RecurringExpense.create({
      userId,
      title: title.trim(),
      amount: parseFloat(amount),
      category: category || 'Subscriptions',
      categoryId: categoryId || undefined,
      frequency: freq,
      startDate: start,
      nextDueDate: nextDue,
      active: active !== undefined ? active : true,
    });

    // If start date is today or in the past, log the initial instance
    const now = new Date();
    if (start <= now && (item.active !== false)) {
      await Expense.create({
        userId,
        title: item.title,
        amount: item.amount,
        category: item.category,
        categoryId: item.categoryId,
        date: start,
        paymentMethod: 'Auto-Debit',
        notes: `Initial subscription payment for ${item.title}`,
        isRecurring: true,
        recurringId: item._id,
      });
      item.lastProcessedDate = now;
      await item.save();
    }

    return res.status(201).json(item);
  } catch (err) {
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

// PATCH /api/recurring/:id
router.patch('/:id', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { title, amount, category, categoryId, frequency, active } = req.body;

    const item = await RecurringExpense.findOne({ _id: req.params.id, userId });
    if (!item) {
      return res.status(404).json({ message: 'Subscription not found' });
    }

    if (title !== undefined) item.title = title.trim();
    if (amount !== undefined) item.amount = parseFloat(amount);
    if (category !== undefined) item.category = category;
    if (categoryId !== undefined) item.categoryId = categoryId;
    if (frequency !== undefined) {
      item.frequency = frequency;
      item.nextDueDate = getNextDueDate(new Date(), frequency);
    }
    if (active !== undefined) item.active = active;

    await item.save();
    return res.json(item);
  } catch (err) {
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

// POST /api/recurring/:id/run-now - Manually trigger subscription expense
router.post('/:id/run-now', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const item = await RecurringExpense.findOne({ _id: req.params.id, userId });
    if (!item) {
      return res.status(404).json({ message: 'Subscription not found' });
    }

    const newExpense = await Expense.create({
      userId,
      title: item.title,
      amount: item.amount,
      category: item.category || 'Subscriptions',
      categoryId: item.categoryId,
      date: new Date(),
      paymentMethod: 'Auto-Debit',
      notes: `Subscription payment logged for ${item.title}`,
      isRecurring: true,
      recurringId: item._id,
    });

    item.lastProcessedDate = new Date();
    item.nextDueDate = getNextDueDate(new Date(), item.frequency);
    await item.save();

    return res.json({
      success: true,
      message: 'Expense created successfully',
      expense: newExpense,
      recurring: item,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

// DELETE /api/recurring/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    await RecurringExpense.findOneAndDelete({ _id: req.params.id, userId });
    return res.json({ success: true, message: 'Recurring expense deleted' });
  } catch (err) {
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

module.exports = router;
module.exports.autoProcessRecurringExpenses = autoProcessRecurringExpenses;

