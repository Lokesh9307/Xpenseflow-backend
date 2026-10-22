const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const TiffinGroup = require('../models/TiffinGroup');
const TiffinEntry = require('../models/TiffinEntry');

// Helper to generate 4-digit code
const generate4DigitCode = () => Math.floor(1000 + Math.random() * 9000).toString();

// GET /api/tiffin/groups — list all groups user is member of or created
router.get('/groups', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const groups = await TiffinGroup.find({
      archived: { $ne: true },
      $or: [{ createdBy: userId }, { 'members.userId': userId }],
    }).sort({ updatedAt: -1 });

    // Enhance each group with active cycle spend and entry count
    const enhancedGroups = await Promise.all(
      groups.map(async (group) => {
        const entries = await TiffinEntry.find({ groupId: group._id });
        const cycleTotal = entries.reduce((s, e) => s + (e.totalPrice || 0), 0);
        const cycleQuantity = entries.reduce((s, e) => s + (e.quantity ?? e.count ?? 0), 0);
        return {
          ...group.toObject(),
          pricePerTiffin: group.defaultPrice || group.pricePerTiffin || 80,
          cycleTotal,
          cycleQuantity,
          entryCount: entries.length,
          inviteCode: group.inviteCode || generate4DigitCode(),
        };
      })
    );

    return res.json(enhancedGroups);
  } catch (err) {
    console.error('GET /api/tiffin/groups error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

// POST /api/tiffin/groups — create new group
router.post('/groups', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, defaultPrice, pricePerTiffin, members } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Tiffin group name required' });
    }

    const price = Number(defaultPrice || pricePerTiffin || 80);
    const inviteCode = generate4DigitCode();

    const initialMembers = [
      { userId, name: req.user.name || 'Admin', email: req.user.email || '' },
    ];

    if (Array.isArray(members)) {
      members.forEach((m) => {
        if (m.name && m.email && m.email !== req.user.email) {
          initialMembers.push({
            name: m.name.trim(),
            email: m.email.trim().toLowerCase(),
          });
        }
      });
    }

    const group = await TiffinGroup.create({
      name: name.trim(),
      defaultPrice: price,
      pricePerTiffin: price,
      inviteCode,
      createdBy: userId,
      members: initialMembers,
    });

    return res.status(201).json(group);
  } catch (err) {
    console.error('POST /api/tiffin/groups error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

// GET /api/tiffin/groups/:id — detailed group view with today entries and history
router.get('/groups/:id', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const groupId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(groupId)) {
      return res.status(400).json({ message: 'Invalid group ID' });
    }

    const group = await TiffinGroup.findById(groupId);
    if (!group) return res.status(404).json({ message: 'Group not found' });

    // Verify user is member or creator
    const isMember =
      String(group.createdBy) === userId ||
      group.members.some((m) => m.userId && String(m.userId) === userId);

    if (!isMember) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (!group.inviteCode) {
      group.inviteCode = generate4DigitCode();
      await group.save();
    }

    const entries = await TiffinEntry.find({ groupId: group._id }).sort({ date: -1 });

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

    const todayEntries = entries.filter((e) => {
      const d = new Date(e.date);
      return d >= todayStart && d < todayEnd;
    });

    const cycleTotal = entries.reduce((s, e) => s + (e.totalPrice || 0), 0);
    const cycleQuantity = entries.reduce((s, e) => s + (e.quantity ?? e.count ?? 0), 0);

    // Member totals
    const memberTotals = {};
    group.members.forEach((m) => {
      memberTotals[String(m._id || m.userId)] = 0;
    });

    entries.forEach((e) => {
      if (e.noTiffin || e.mealType === 'none') return;
      if (Array.isArray(e.participants) && e.participants.length > 0) {
        const share = (e.totalPrice || 0) / e.participants.length;
        e.participants.forEach((p) => {
          const id = String(p.memberId);
          memberTotals[id] = (memberTotals[id] || 0) + share;
        });
      } else {
        const id = String(e.userId);
        memberTotals[id] = (memberTotals[id] || 0) + (e.totalPrice || 0);
      }
    });

    return res.json({
      group,
      entries,
      todayEntries,
      cycleTotal,
      cycleQuantity,
      memberTotals,
      inviteCode: group.inviteCode,
      isCreator: String(group.createdBy) === userId,
      canWrite: true,
    });
  } catch (err) {
    console.error('GET /api/tiffin/groups/:id error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

// POST /api/tiffin/groups/:id/entries — create a meal entry or "no tiffin today"
router.post('/groups/:id/entries', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const groupId = req.params.id;
    const { mealType, count, quantity, extraPrice, notes, date, noTiffin, participants } = req.body;

    const group = await TiffinGroup.findById(groupId);
    if (!group) return res.status(404).json({ message: 'Group not found' });

    const isNoMeal = noTiffin === true || mealType === 'none' || count === 0 || quantity === 0;
    const normalizedMeal = isNoMeal ? 'none' : (mealType || 'lunch').toLowerCase();
    const mealCount = isNoMeal ? 0 : Math.max(1, parseInt(quantity || count, 10) || 1);
    const extra = isNoMeal ? 0 : parseFloat(extraPrice) || 0;
    const pricePerUnit = group.defaultPrice || group.pricePerTiffin || 80;
    const totalPrice = isNoMeal ? 0 : pricePerUnit * mealCount + extra;

    const entry = await TiffinEntry.create({
      groupId,
      userId,
      date: date ? new Date(date) : new Date(),
      mealType: normalizedMeal,
      count: mealCount,
      quantity: mealCount,
      extraPrice: extra,
      totalPrice,
      noTiffin: isNoMeal,
      participants: Array.isArray(participants) ? participants : [],
      notes: isNoMeal ? (notes || 'No one took tiffin today') : (notes || ''),
    });

    return res.status(201).json(entry);
  } catch (err) {
    console.error('POST /api/tiffin/groups/:id/entries error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

// PATCH /api/tiffin/groups/:id/entries/:entryId — edit entry
router.patch('/groups/:id/entries/:entryId', auth, async (req, res) => {
  try {
    const { id: groupId, entryId } = req.params;
    const { mealType, count, quantity, extraPrice, notes, date, noTiffin, participants } = req.body;

    const group = await TiffinGroup.findById(groupId);
    if (!group) return res.status(404).json({ message: 'Group not found' });

    const entry = await TiffinEntry.findOne({ _id: entryId, groupId });
    if (!entry) return res.status(404).json({ message: 'Entry not found' });

    const isNoMeal = noTiffin === true || mealType === 'none';
    if (isNoMeal) {
      entry.noTiffin = true;
      entry.mealType = 'none';
      entry.count = 0;
      entry.quantity = 0;
      entry.extraPrice = 0;
      entry.totalPrice = 0;
      entry.notes = notes || 'No one took tiffin today';
    } else {
      if (mealType) entry.mealType = mealType.toLowerCase();
      const mealCount = Math.max(1, parseInt(quantity || count || entry.quantity || 1, 10));
      const extra = extraPrice !== undefined ? parseFloat(extraPrice) || 0 : (entry.extraPrice || 0);
      const pricePerUnit = group.defaultPrice || group.pricePerTiffin || 80;
      entry.count = mealCount;
      entry.quantity = mealCount;
      entry.extraPrice = extra;
      entry.totalPrice = pricePerUnit * mealCount + extra;
      entry.noTiffin = false;
      if (notes !== undefined) entry.notes = notes;
      if (participants !== undefined) entry.participants = participants;
    }

    if (date) entry.date = new Date(date);
    await entry.save();

    return res.json(entry);
  } catch (err) {
    console.error('PATCH /api/tiffin/entries error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

// DELETE /api/tiffin/groups/:id/entries/:entryId — delete entry
router.delete('/groups/:id/entries/:entryId', auth, async (req, res) => {
  try {
    const { id: groupId, entryId } = req.params;
    const result = await TiffinEntry.deleteOne({ _id: entryId, groupId });
    if (result.deletedCount === 0) {
      return res.status(404).json({ message: 'Entry not found' });
    }
    return res.json({ message: 'Entry deleted' });
  } catch (err) {
    console.error('DELETE /api/tiffin/entries error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

// POST /api/tiffin/join/code — join group using 4-digit numeric code
router.post('/join/code', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { code } = req.body;

    if (!code || !/^\d{4}$/.test(code.trim())) {
      return res.status(400).json({ message: 'Enter a valid 4-digit code' });
    }

    const group = await TiffinGroup.findOne({
      inviteCode: code.trim(),
      archived: { $ne: true },
    });

    if (!group) {
      return res.status(404).json({ message: 'Invalid or expired tiffin code.' });
    }

    // Check if already in group
    const alreadyJoined =
      String(group.createdBy) === userId ||
      group.members.some((m) => m.userId && String(m.userId) === userId);

    if (alreadyJoined) {
      return res.json({ message: 'Already a member', groupId: group._id });
    }

    // Add user as member
    group.members.push({
      userId,
      name: req.user.name || 'Member',
      email: req.user.email || '',
    });

    await group.save();
    return res.json({ message: 'Joined successfully!', groupId: group._id, groupName: group.name });
  } catch (err) {
    console.error('POST /api/tiffin/join/code error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

// POST /api/tiffin/groups/:id/invite — regenerate 4-digit invite code
router.post('/groups/:id/invite', auth, async (req, res) => {
  try {
    const groupId = req.params.id;
    const group = await TiffinGroup.findById(groupId);
    if (!group) return res.status(404).json({ message: 'Group not found' });

    group.inviteCode = generate4DigitCode();
    await group.save();

    return res.json({ inviteCode: group.inviteCode });
  } catch (err) {
    console.error('POST /api/tiffin/groups/:id/invite error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

// GET /api/tiffin/transactions — all-date transaction check across all groups with month filter
router.get('/transactions', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { month } = req.query; // YYYY-MM

    const groups = await TiffinGroup.find({
      archived: { $ne: true },
      $or: [{ createdBy: userId }, { 'members.userId': userId }],
    });

    const groupIds = groups.map((g) => g._id);
    const groupMap = {};
    groups.forEach((g) => {
      groupMap[String(g._id)] = g.name;
    });

    let dateFilter = {};
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      const [year, monthNum] = month.split('-').map(Number);
      const start = new Date(year, monthNum - 1, 1);
      const end = new Date(year, monthNum, 1);
      dateFilter = { date: { $gte: start, $lt: end } };
    }

    const entries = await TiffinEntry.find({
      groupId: { $in: groupIds },
      ...dateFilter,
    })
      .sort({ date: -1 })
      .limit(300);

    const formatted = entries.map((e) => ({
      _id: e._id,
      groupId: e.groupId,
      groupName: groupMap[String(e.groupId)] || 'Tiffin Group',
      date: e.date,
      mealType: e.mealType || 'lunch',
      count: e.count ?? e.quantity ?? 1,
      quantity: e.quantity ?? e.count ?? 1,
      extraPrice: e.extraPrice || 0,
      totalPrice: e.totalPrice || 0,
      totalCost: e.totalPrice || 0,
      noTiffin: e.noTiffin || e.mealType === 'none',
      notes: e.notes || '',
      participants: e.participants || [],
    }));

    return res.json(formatted);
  } catch (err) {
    console.error('GET /api/tiffin/transactions error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

module.exports = router;
