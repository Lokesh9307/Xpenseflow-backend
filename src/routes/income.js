const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Income = require('../models/Income');
const Expense = require('../models/Expense');

// GET /api/income/history (return full user income transactions for offline sync)
router.get('/history', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const incomes = await Income.find({ userId }).sort({ date: -1 });
    return res.json(incomes);
  } catch (err) {
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

// GET /api/income (summary)
router.get('/', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const [monthExpenses, monthIncomes] = await Promise.all([
      Expense.find({ userId, date: { $gte: startOfMonth, $lte: endOfMonth } }),
      Income.find({ userId, date: { $gte: startOfMonth, $lte: endOfMonth } }),
    ]);

    const monthExpense = monthExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);
    const monthIncome = monthIncomes.reduce((sum, i) => sum + (i.amount || 0), 0);

    // Week series (last 7 days)
    const week = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const startOfDay = new Date(d.setHours(0, 0, 0, 0));
      const endOfDay = new Date(d.setHours(23, 59, 59, 999));

      const dayExpense = monthExpenses
        .filter((e) => e.date >= startOfDay && e.date <= endOfDay)
        .reduce((sum, e) => sum + (e.amount || 0), 0);

      const dayIncome = monthIncomes
        .filter((inc) => inc.date >= startOfDay && inc.date <= endOfDay)
        .reduce((sum, inc) => sum + (inc.amount || 0), 0);

      week.push({ date: dateStr, expense: dayExpense, income: dayIncome });
    }

    return res.json({
      monthExpense,
      monthIncome,
      week,
    });
  } catch (err) {
    console.error('Income summary error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

// POST /api/income
router.post('/', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { amount, source, date, note } = req.body;

    if (!amount) {
      return res.status(400).json({ message: 'Amount is required' });
    }

    const income = await Income.create({
      userId,
      amount: parseFloat(amount),
      source: source || 'Salary',
      date: date ? new Date(date) : new Date(),
      note: note || '',
    });

    return res.status(201).json(income);
  } catch (err) {
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

module.exports = router;
