const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Expense = require('../models/Expense');
const Budget = require('../models/Budget');
const Category = require('../models/Category');

const { autoProcessRecurringExpenses } = require('./recurring');

// GET /api/expenses
router.get('/', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    if (typeof autoProcessRecurringExpenses === 'function') {
      await autoProcessRecurringExpenses(userId);
    }
    const { category, search, limit, sortBy, sortOrder, month } = req.query;

    const query = { userId };
    if (category && category !== 'All') {
      query.category = category;
    }
    if (search) {
      query.title = { $regex: search, $options: 'i' };
    }
    if (month && month !== 'all') {
      const [year, m] = month.split('-').map(Number);
      if (year && m) {
        // Broad UTC/Local range to ensure all transactions in that month are returned
        const startOfMonth = new Date(Date.UTC(year, m - 1, 1, 0, 0, 0, 0));
        const endOfMonth = new Date(Date.UTC(year, m, 1, 0, 0, 0, 0)); // Start of next month
        query.date = { $gte: startOfMonth, $lt: endOfMonth };
      }
    }

    const sortField = sortBy || 'date';
    const sortDir = sortOrder === 'asc' ? 1 : -1;
    const maxLimit = limit ? parseInt(limit, 10) : 100;

    const expenses = await Expense.find(query)
      .sort({ [sortField]: sortDir })
      .limit(maxLimit);

    return res.json(expenses);
  } catch (err) {
    console.error('Fetch expenses error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

// POST /api/expenses
router.post('/', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { title, amount, category, paymentMethod, date, notes, location } = req.body;

    if (!title || !amount) {
      return res.status(400).json({ message: 'Title and amount are required' });
    }

    const expenseDate = date ? new Date(date) : new Date();

    const expense = await Expense.create({
      userId,
      title,
      amount: parseFloat(amount),
      category: category || 'Others',
      paymentMethod: paymentMethod || 'UPI',
      date: expenseDate,
      notes: notes || '',
      location: location || '',
    });

    // Update budget if matching category exists
    const month = `${expenseDate.getFullYear()}-${String(expenseDate.getMonth() + 1).padStart(2, '0')}`;
    const cat = await Category.findOne({ userId, name: expense.category });
    if (cat) {
      await Budget.findOneAndUpdate(
        { userId, categoryId: cat._id, month },
        { $inc: { spent: expense.amount }, $setOnInsert: { limit: cat.limit } },
        { upsert: true }
      );
    }

    return res.status(201).json(expense);
  } catch (err) {
    console.error('Create expense error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

// PUT /api/expenses/:id
router.put('/:id', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const updated = await Expense.findOneAndUpdate(
      { _id: req.params.id, userId },
      { $set: req.body },
      { new: true }
    );
    if (!updated) return res.status(404).json({ message: 'Expense not found' });
    return res.json(updated);
  } catch (err) {
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

// DELETE /api/expenses/reset — delete all expenses and reset budgets for user
router.delete('/reset', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    await Expense.deleteMany({ userId });
    await Budget.deleteMany({ userId });
    return res.json({ success: true, message: 'All expenses and budgets have been reset successfully' });
  } catch (err) {
    console.error('Reset expenses error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

// DELETE /api/expenses/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const deleted = await Expense.findOneAndDelete({ _id: req.params.id, userId });
    if (!deleted) return res.status(404).json({ message: 'Expense not found' });
    return res.json({ success: true, message: 'Expense deleted' });
  } catch (err) {
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

module.exports = router;
