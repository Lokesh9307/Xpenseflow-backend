const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const SplitGroup = require('../models/SplitGroup');
const SplitExpense = require('../models/SplitExpense');

// GET /api/split/summary
router.get('/summary', auth, async (req, res) => {
  try {
    const userId = req.user.id;

    // Split expenses where user paid (owed to user)
    const paidByMe = await SplitExpense.find({ paidBy: userId });
    let totalOwedToYou = 0;
    paidByMe.forEach((exp) => {
      exp.splitBetween.forEach((split) => {
        if (split.userId && split.userId.toString() !== userId) {
          totalOwedToYou += split.amount || 0;
        }
      });
    });

    // Split expenses where user is a split participant (user owes)
    const splitForMe = await SplitExpense.find({
      paidBy: { $ne: userId },
      'splitBetween.userId': userId,
    });
    let totalYouOwe = 0;
    splitForMe.forEach((exp) => {
      const mySplit = exp.splitBetween.find(
        (s) => s.userId && s.userId.toString() === userId
      );
      if (mySplit) totalYouOwe += mySplit.amount || 0;
    });

    return res.json({
      totalOwedToYou,
      totalYouOwe,
      netBalance: totalOwedToYou - totalYouOwe,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

// GET /api/split/groups
router.get('/groups', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const groups = await SplitGroup.find({
      $or: [{ createdBy: userId }, { 'members.userId': userId }],
    }).sort({ updatedAt: -1 });

    return res.json(groups);
  } catch (err) {
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

// POST /api/split/groups
router.post('/groups', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, currency } = req.body;

    if (!name) return res.status(400).json({ message: 'Group name is required' });

    const group = await SplitGroup.create({
      name,
      currency: currency || 'INR',
      createdBy: userId,
      members: [{ userId, name: req.user.name, email: req.user.email }],
    });

    return res.status(201).json(group);
  } catch (err) {
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

// POST /api/split/groups/:id/expenses
router.post('/groups/:id/expenses', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const groupId = req.params.id;
    const { description, amount, date } = req.body;

    if (!description || !amount) {
      return res.status(400).json({ message: 'Description and amount required' });
    }

    const group = await SplitGroup.findById(groupId);
    if (!group) return res.status(404).json({ message: 'Group not found' });

    const memberCount = group.members.length || 1;
    const splitAmt = Math.round((parseFloat(amount) / memberCount) * 100) / 100;

    const splitBetween = group.members.map((m) => ({
      userId: m.userId,
      amount: splitAmt,
    }));

    const expense = await SplitExpense.create({
      groupId,
      description,
      amount: parseFloat(amount),
      paidBy: userId,
      splitBetween,
      date: date ? new Date(date) : new Date(),
    });

    return res.status(201).json(expense);
  } catch (err) {
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

module.exports = router;
