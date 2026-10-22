const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const TiffinGroup = require('../models/TiffinGroup');
const TiffinEntry = require('../models/TiffinEntry');

// Helper to generate static, unique 4-digit code per group
const getStaticGroupCode = (groupOrId) => {
  if (!groupOrId) return '8824';
  if (typeof groupOrId === 'object' && groupOrId.inviteCode && /^\d{4}$/.test(String(groupOrId.inviteCode))) {
    return String(groupOrId.inviteCode);
  }
  const idStr = String(typeof groupOrId === 'object' ? (groupOrId._id || groupOrId.id || groupOrId.name) : groupOrId);
  let hash = 0;
  for (let i = 0; i < idStr.length; i++) {
    hash = (hash << 5) - hash + idStr.charCodeAt(i);
    hash |= 0;
  }
  return String(Math.abs(hash) % 9000 + 1000);
};

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
        let staticCode = group.inviteCode;
        if (!staticCode || !/^\d{4}$/.test(String(staticCode))) {
          staticCode = getStaticGroupCode(group);
          group.inviteCode = staticCode;
          group.save().catch(() => {});
        }

        const entries = await TiffinEntry.find({ groupId: group._id });
        const cycleTotal = entries.reduce((s, e) => s + (e.totalPrice || 0), 0);
        const cycleQuantity = entries.reduce((s, e) => s + (e.quantity ?? e.count ?? 0), 0);
        return {
          ...group.toObject(),
          pricePerTiffin: group.defaultPrice || group.pricePerTiffin || 80,
          cycleTotal,
          cycleQuantity,
          entryCount: entries.length,
          inviteCode: staticCode,
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

    const group = new TiffinGroup({
      name: name.trim(),
      defaultPrice: price,
      pricePerTiffin: price,
      createdBy: userId,
      members: initialMembers,
    });
    group.inviteCode = getStaticGroupCode(group);
    await group.save();

    return res.status(201).json(group);
  } catch (err) {
    console.error('POST /api/tiffin/groups error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

// PATCH /api/tiffin/groups/:id — update group configuration (name, pricePerTiffin, etc.)
router.patch('/groups/:id', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const groupId = req.params.id;
    const { name, defaultPrice, pricePerTiffin } = req.body;

    const group = await TiffinGroup.findById(groupId);
    if (!group) return res.status(404).json({ message: 'Group not found' });

    // Verify creator or member
    const isAllowed =
      String(group.createdBy) === userId ||
      group.members.some((m) => m.userId && String(m.userId) === userId);

    if (!isAllowed) {
      return res.status(403).json({ message: 'Not authorized to edit this group' });
    }

    if (name && name.trim()) {
      group.name = name.trim();
    }
    if (defaultPrice !== undefined || pricePerTiffin !== undefined) {
      const price = parseFloat(defaultPrice ?? pricePerTiffin) || 80;
      group.defaultPrice = price;
      group.pricePerTiffin = price;
    }

    await group.save();
    return res.json(group);
  } catch (err) {
    console.error('PATCH /api/tiffin/groups/:id error:', err);
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

    if (!group.inviteCode || !/^\d{4}$/.test(String(group.inviteCode))) {
      group.inviteCode = getStaticGroupCode(group);
      await group.save().catch(() => {});
    }

    // Month filtering & auto-reset on 1st of month
    const now = new Date();
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const selectedMonthKey = (req.query.month && /^\d{4}-\d{2}$/.test(req.query.month))
      ? req.query.month
      : currentMonthKey;

    const [sYear, sMonth] = selectedMonthKey.split('-').map(Number);
    const monthStart = new Date(sYear, sMonth - 1, 1, 0, 0, 0, 0);
    const monthEnd = new Date(sYear, sMonth, 1, 0, 0, 0, 0);

    const entries = await TiffinEntry.find({ groupId: group._id }).sort({ date: -1 });

    // Available months list across all recorded entries
    const monthSet = new Set([currentMonthKey, selectedMonthKey]);
    entries.forEach((e) => {
      if (e.date) {
        try {
          monthSet.add(new Date(e.date).toISOString().slice(0, 7));
        } catch (_) {}
      }
    });
    const availableMonths = Array.from(monthSet).sort().reverse();

    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

    const todayEntries = entries.filter((e) => {
      const d = new Date(e.date);
      return d >= todayStart && d < todayEnd;
    });

    // Entries for the selected month (resets to 0 on 1st of every month automatically)
    const monthEntries = entries.filter((e) => {
      const d = new Date(e.date);
      return d >= monthStart && d < monthEnd;
    });

    const monthTotal = monthEntries.reduce((s, e) => s + (e.totalPrice || 0), 0);
    const monthQuantity = monthEntries.reduce((s, e) => s + (e.quantity ?? e.count ?? 0), 0);

    // Lifetime totals
    const cycleTotal = entries.reduce((s, e) => s + (e.totalPrice || 0), 0);
    const cycleQuantity = entries.reduce((s, e) => s + (e.quantity ?? e.count ?? 0), 0);

    // Compute detailed member stats for the selected month
    const memberTotals = {};
    const memberStats = {};
    group.members.forEach((m) => {
      const mId = String(m._id || m.userId);
      memberTotals[mId] = 0;
      memberStats[mId] = {
        memberId: mId,
        name: m.name || 'Member',
        email: m.email || '',
        mealsCount: 0,
        extraTiffins: 0,
        baseTotal: 0,
        extraTotal: 0,
        totalDue: 0,
      };
    });

    monthEntries.forEach((e) => {
      if (e.noTiffin || e.mealType === 'none') return;
      const pricePerUnit = group.pricePerTiffin || group.defaultPrice || 80;

      if (e.memberBills && Object.keys(e.memberBills).length > 0) {
        Object.entries(e.memberBills).forEach(([id, amt]) => {
          const due = parseFloat(amt) || 0;
          memberTotals[id] = (memberTotals[id] || 0) + due;
          if (memberStats[id]) {
            const extraCount = (e.extras && e.extras[id]) ? parseInt(e.extras[id], 10) || 0 : 0;
            const extraAmt = extraCount * pricePerUnit;
            const baseAmt = Math.max(0, due - extraAmt);
            memberStats[id].totalDue += due;
            memberStats[id].extraTiffins += extraCount;
            memberStats[id].extraTotal += extraAmt;
            memberStats[id].baseTotal += baseAmt;
            if (due > 0) memberStats[id].mealsCount += 1;
          }
        });
      } else if (Array.isArray(e.participants) && e.participants.length > 0) {
        const share = (e.totalPrice || 0) / e.participants.length;
        e.participants.forEach((p) => {
          const id = String(p.memberId);
          memberTotals[id] = (memberTotals[id] || 0) + share;
          if (memberStats[id]) {
            memberStats[id].totalDue += share;
            memberStats[id].baseTotal += share;
            memberStats[id].mealsCount += 1;
          }
        });
      } else {
        const id = String(e.userId);
        memberTotals[id] = (memberTotals[id] || 0) + (e.totalPrice || 0);
        if (memberStats[id]) {
          memberStats[id].totalDue += (e.totalPrice || 0);
          memberStats[id].baseTotal += (e.totalPrice || 0);
          memberStats[id].mealsCount += 1;
        }
      }
    });

    return res.json({
      group,
      selectedMonth: selectedMonthKey,
      availableMonths,
      entries: monthEntries, // Default to monthEntries for monthly ledger
      allEntries: entries,
      todayEntries,
      monthTotal,
      monthQuantity,
      cycleTotal: monthTotal, // Cycle total now represents the active month
      cycleQuantity: monthQuantity,
      lifetimeTotal: cycleTotal,
      lifetimeQuantity: cycleQuantity,
      memberTotals,
      memberStats: Object.values(memberStats),
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
    const { mealType, count, quantity, baseQuantity, splitMemberIds, extras, extraPrice, notes, date, noTiffin, participants } = req.body;

    const group = await TiffinGroup.findById(groupId);
    if (!group) return res.status(404).json({ message: 'Group not found' });

    const isNoMeal = noTiffin === true || mealType === 'none' || count === 0 || quantity === 0;
    const normalizedMeal = isNoMeal ? 'none' : (mealType || 'lunch').toLowerCase();
    const pricePerUnit = group.defaultPrice || group.pricePerTiffin || 80;

    let mealCount = 0;
    let totalPrice = 0;
    let memberBills = {};
    let splitIds = [];
    let extrasMap = extras || {};

    if (!isNoMeal) {
      const baseQty = baseQuantity !== undefined
        ? parseInt(baseQuantity, 10)
        : (parseInt(quantity || count, 10) || 1);

      splitIds = Array.isArray(splitMemberIds) && splitMemberIds.length > 0
        ? splitMemberIds
        : group.members.map((m) => String(m._id || m.userId));

      const extraTiffinsTotal = Object.values(extrasMap).reduce((s, k) => s + (parseInt(k, 10) || 0), 0);
      mealCount = baseQty + extraTiffinsTotal;
      const extraVal = parseFloat(extraPrice) || 0;
      totalPrice = (baseQty * pricePerUnit) + (extraTiffinsTotal * pricePerUnit) + extraVal;

      // Calculate member bills (base shared evenly + extra tiffins at full price)
      const basePerPerson = splitIds.length > 0 ? (baseQty * pricePerUnit) / splitIds.length : 0;
      group.members.forEach((m) => {
        const mId = String(m._id || m.userId);
        let bill = splitIds.includes(mId) ? basePerPerson : 0;
        if (extrasMap[mId]) {
          bill += (parseInt(extrasMap[mId], 10) || 0) * pricePerUnit;
        }
        memberBills[mId] = Math.round(bill * 100) / 100;
      });
    }

    const entry = await TiffinEntry.create({
      groupId,
      userId,
      date: date ? new Date(date) : new Date(),
      mealType: normalizedMeal,
      count: mealCount,
      quantity: mealCount,
      baseQuantity: isNoMeal ? 0 : (baseQuantity || mealCount),
      splitMemberIds: splitIds,
      extras: extrasMap,
      memberBills,
      extraPrice: isNoMeal ? 0 : (parseFloat(extraPrice) || 0),
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

// PATCH /api/tiffin/groups/:id/entries/:entryId — edit entry with full split recalculation
router.patch('/groups/:id/entries/:entryId', auth, async (req, res) => {
  try {
    const { id: groupId, entryId } = req.params;
    const { mealType, count, quantity, baseQuantity, splitMemberIds, extras, extraPrice, notes, date, noTiffin, participants } = req.body;

    const group = await TiffinGroup.findById(groupId);
    if (!group) return res.status(404).json({ message: 'Group not found' });

    const entry = await TiffinEntry.findOne({ _id: entryId, groupId });
    if (!entry) return res.status(404).json({ message: 'Entry not found' });

    const isNoMeal = noTiffin === true || mealType === 'none';
    const pricePerUnit = group.defaultPrice || group.pricePerTiffin || 80;

    if (isNoMeal) {
      entry.noTiffin = true;
      entry.mealType = 'none';
      entry.count = 0;
      entry.quantity = 0;
      entry.baseQuantity = 0;
      entry.extras = {};
      entry.memberBills = {};
      entry.extraPrice = 0;
      entry.totalPrice = 0;
      entry.notes = notes || 'No one took tiffin today';
    } else {
      entry.noTiffin = false;
      if (mealType) entry.mealType = mealType.toLowerCase();

      const baseQty = baseQuantity !== undefined
        ? parseInt(baseQuantity, 10)
        : (parseInt(quantity || count || entry.baseQuantity || 1, 10));

      const splitIds = Array.isArray(splitMemberIds) && splitMemberIds.length > 0
        ? splitMemberIds
        : (entry.splitMemberIds && entry.splitMemberIds.length > 0 ? entry.splitMemberIds : group.members.map((m) => String(m._id || m.userId)));

      const extrasMap = extras !== undefined ? extras : (entry.extras || {});
      const extraTiffinsTotal = Object.values(extrasMap).reduce((s, k) => s + (parseInt(k, 10) || 0), 0);
      const totalQty = baseQty + extraTiffinsTotal;

      entry.count = totalQty;
      entry.quantity = totalQty;
      entry.baseQuantity = baseQty;
      entry.splitMemberIds = splitIds;
      entry.extras = extrasMap;

      const extraVal = extraPrice !== undefined ? parseFloat(extraPrice) || 0 : (entry.extraPrice || 0);
      entry.extraPrice = extraVal;
      entry.totalPrice = (baseQty * pricePerUnit) + (extraTiffinsTotal * pricePerUnit) + extraVal;

      // Recalculate member bills
      const basePerPerson = splitIds.length > 0 ? (baseQty * pricePerUnit) / splitIds.length : 0;
      const memberBills = {};
      group.members.forEach((m) => {
        const mId = String(m._id || m.userId);
        let bill = splitIds.includes(mId) ? basePerPerson : 0;
        if (extrasMap[mId]) {
          bill += (parseInt(extrasMap[mId], 10) || 0) * pricePerUnit;
        }
        memberBills[mId] = Math.round(bill * 100) / 100;
      });
      entry.memberBills = memberBills;

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

    const cleanCode = code.trim();
    let group = await TiffinGroup.findOne({
      inviteCode: cleanCode,
      archived: { $ne: true },
    });

    if (!group) {
      // Also check against deterministic static codes across active groups
      const allGroups = await TiffinGroup.find({ archived: { $ne: true } });
      group = allGroups.find((g) => getStaticGroupCode(g) === cleanCode);
      if (group) {
        group.inviteCode = cleanCode;
        await group.save().catch(() => {});
      }
    }

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

// POST /api/tiffin/groups/:id/invite — return static 4-digit invite code
router.post('/groups/:id/invite', auth, async (req, res) => {
  try {
    const groupId = req.params.id;
    const group = await TiffinGroup.findById(groupId);
    if (!group) return res.status(404).json({ message: 'Group not found' });

    if (!group.inviteCode || !/^\d{4}$/.test(String(group.inviteCode))) {
      group.inviteCode = getStaticGroupCode(group);
      await group.save().catch(() => {});
    }

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
