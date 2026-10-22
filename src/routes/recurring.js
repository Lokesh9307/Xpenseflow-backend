const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const RecurringExpense = require('../models/RecurringExpense');

// GET /api/recurring
router.get('/', auth, async (req, res) => {
  try {
    const userId = req.user.id;
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
    const { title, amount, frequency, startDate, active } = req.body;

    if (!title || !amount) {
      return res.status(400).json({ message: 'Title and amount are required' });
    }

    const item = await RecurringExpense.create({
      userId,
      title,
      amount: parseFloat(amount),
      frequency: frequency || 'monthly',
      startDate: startDate ? new Date(startDate) : new Date(),
      active: active !== undefined ? active : true,
    });

    return res.status(201).json(item);
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
