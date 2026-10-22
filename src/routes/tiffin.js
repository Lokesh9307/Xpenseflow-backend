const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const TiffinGroup = require('../models/TiffinGroup');
const TiffinEntry = require('../models/TiffinEntry');

// GET /api/tiffin/groups
router.get('/groups', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const groups = await TiffinGroup.find({
      $or: [{ createdBy: userId }, { 'members.userId': userId }],
    }).sort({ updatedAt: -1 });

    return res.json(groups);
  } catch (err) {
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

// POST /api/tiffin/groups
router.post('/groups', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, defaultPrice } = req.body;

    if (!name) return res.status(400).json({ message: 'Tiffin group name required' });

    const group = await TiffinGroup.create({
      name,
      defaultPrice: defaultPrice || 80,
      createdBy: userId,
      members: [{ userId, name: req.user.name, email: req.user.email }],
    });

    return res.status(201).json(group);
  } catch (err) {
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

// POST /api/tiffin/groups/:id/entries
router.post('/groups/:id/entries', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const groupId = req.params.id;
    const { mealType, count, extraPrice, notes, date } = req.body;

    const group = await TiffinGroup.findById(groupId);
    if (!group) return res.status(404).json({ message: 'Group not found' });

    const mealCount = parseInt(count, 10) || 1;
    const extra = parseFloat(extraPrice) || 0;
    const totalPrice = (group.defaultPrice || 80) * mealCount + extra;

    const entry = await TiffinEntry.create({
      groupId,
      userId,
      mealType: mealType || 'Lunch',
      count: mealCount,
      extraPrice: extra,
      totalPrice,
      notes: notes || '',
      date: date ? new Date(date) : new Date(),
    });

    return res.status(201).json(entry);
  } catch (err) {
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

// GET /api/tiffin/transactions
router.get('/transactions', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const entries = await TiffinEntry.find({ userId })
      .populate('groupId')
      .sort({ date: -1 })
      .limit(50);

    return res.json(entries);
  } catch (err) {
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

module.exports = router;
