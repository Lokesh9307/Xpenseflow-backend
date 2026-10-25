const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const TiffinGroup = require('../models/TiffinGroup');
const TiffinEntry = require('../models/TiffinEntry');
const User = require('../models/User');
const Category = require('../models/Category');
const Expense = require('../models/Expense');

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

// Helper to calculate exact per-person bills from any entry (supporting web shared-split & legacy)
function calculateEntryBills(entry, pricePerUnit, groupMembers = []) {
  const price = Number(entry.pricePerTiffin || entry.price || pricePerUnit || 100);
  const bills = {};

  // 1. If explicit memberBills is populated
  if (entry.memberBills && Object.keys(entry.memberBills).length > 0) {
    Object.entries(entry.memberBills).forEach(([id, amt]) => {
      const val = typeof amt === 'object' && amt !== null ? (amt.total ?? amt.amount ?? amt.base) : amt;
      const num = parseFloat(val) || 0;
      bills[String(id)] = Math.round(num * 100) / 100;
    });
    return bills;
  }

  // 2. Web shared-split model: baseQuantity > 0 and participantMemberIds
  const baseQty = Math.floor(Number(entry.baseQuantity) || 0);
  const participantIds = Array.isArray(entry.participantMemberIds) && entry.participantMemberIds.length > 0
    ? entry.participantMemberIds.map(String)
    : (Array.isArray(entry.splitMemberIds) && entry.splitMemberIds.length > 0 ? entry.splitMemberIds.map(String) : []);

  if (baseQty > 0 && participantIds.length > 0) {
    const uniqueParticipants = [...new Set(participantIds.filter(Boolean))];
    const baseShare = Math.round(((baseQty * price) / uniqueParticipants.length) * 100) / 100;
    const extrasMap = entry.participantQuantities || entry.extras || {};

    uniqueParticipants.forEach((pid) => {
      bills[pid] = (bills[pid] || 0) + baseShare;
    });

    Object.entries(extrasMap).forEach(([pid, k]) => {
      const extraCount = Math.max(0, Math.floor(Number(k) || 0));
      if (extraCount > 0) {
        bills[String(pid)] = Math.round(((bills[String(pid)] || 0) + extraCount * price) * 100) / 100;
      }
    });

    return bills;
  }

  // 3. Web per-participant quantities / participantMemberIds
  if (participantIds.length > 0) {
    const uniqueParticipants = [...new Set(participantIds.filter(Boolean))];
    const extrasMap = entry.participantQuantities || entry.extras || {};
    uniqueParticipants.forEach((pid) => {
      const count = Math.max(1, Math.floor(Number(extrasMap[pid]) || 1));
      bills[pid] = Math.round(count * price * 100) / 100;
    });
    return bills;
  }

  // 4. Participants array format
  if (Array.isArray(entry.participants) && entry.participants.length > 0) {
    const total = Number(entry.totalCost ?? entry.totalPrice ?? (price * entry.participants.length));
    const share = Math.round((total / entry.participants.length) * 100) / 100;
    entry.participants.forEach((p) => {
      const pId = String(p.memberId || p._id || p.userId);
      bills[pId] = share;
    });
    return bills;
  }

  // 5. Fallback: split totalCost / totalPrice equally across all group members
  const total = Number(entry.totalCost ?? entry.totalPrice ?? (price * (entry.quantity || entry.count || 1)));
  if (Array.isArray(groupMembers) && groupMembers.length > 0) {
    const splitShare = Math.round((total / groupMembers.length) * 100) / 100;
    groupMembers.forEach((m) => {
      const mId = String(m._id || m.userId);
      bills[mId] = splitShare;
    });
    return bills;
  }

  // 6. Single-user fallback
  const fallbackId = String(entry.userId || entry.addedBy || '0');
  bills[fallbackId] = total;
  return bills;
}

// GET /api/tiffin/groups — list all groups user is member of or created
router.get('/groups', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const userEmail = req.user.email ? req.user.email.toLowerCase().trim() : '';

    const groups = await TiffinGroup.find({
      archived: { $ne: true },
      $or: [
        { createdBy: userId },
        { 'members.userId': userId },
        ...(userEmail ? [{ 'members.email': userEmail }] : []),
      ],
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
        const price = Number(group.pricePerTiffin || group.defaultPrice || 100);
        const cycleTotal = entries.reduce(
          (s, e) => s + (e.totalCost ?? e.totalPrice ?? ((e.quantity ?? e.count ?? 1) * price)),
          0
        );
        const cycleQuantity = entries.reduce((s, e) => s + (e.quantity ?? e.count ?? (e.noTiffin ? 0 : 1)), 0);
        return {
          ...group.toObject(),
          defaultPrice: price,
          pricePerTiffin: price,
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

    const price = Number(pricePerTiffin || defaultPrice || 100);

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
      const price = parseFloat(pricePerTiffin ?? defaultPrice) || 100;
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

    const pricePerUnit = Number(group.pricePerTiffin || group.defaultPrice || 100);

    const monthTotal = monthEntries.reduce(
      (s, e) => s + (e.totalCost ?? e.totalPrice ?? ((e.quantity ?? e.count ?? 1) * pricePerUnit)),
      0
    );
    const monthQuantity = monthEntries.reduce(
      (s, e) => s + (e.quantity ?? e.count ?? (e.noTiffin ? 0 : 1)),
      0
    );

    // Lifetime totals
    const cycleTotal = entries.reduce(
      (s, e) => s + (e.totalCost ?? e.totalPrice ?? ((e.quantity ?? e.count ?? 1) * pricePerUnit)),
      0
    );
    const cycleQuantity = entries.reduce(
      (s, e) => s + (e.quantity ?? e.count ?? (e.noTiffin ? 0 : 1)),
      0
    );

    // Compute detailed member stats for the selected month using web-compatible split math
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
      const entryPrice = Number(e.pricePerTiffin || pricePerUnit);
      const bills = calculateEntryBills(e, entryPrice, group.members);

      group.members.forEach((m, idx) => {
        const mId = String(m._id || m.userId);
        const mUserId = m.userId ? String(m.userId) : '';
        const idxStr = String(idx);

        let due = 0;
        if (bills[mId] !== undefined) due = bills[mId];
        else if (mUserId && bills[mUserId] !== undefined) due = bills[mUserId];
        else if (bills[idxStr] !== undefined) due = bills[idxStr];

        if (due > 0) {
          memberTotals[mId] = Math.round(((memberTotals[mId] || 0) + due) * 100) / 100;
          if (memberStats[mId]) {
            const extrasMap = e.participantQuantities || e.extras || {};
            const extraCount = parseInt(extrasMap[mId] ?? (mUserId ? extrasMap[mUserId] : undefined) ?? extrasMap[idxStr] ?? 0, 10) || 0;
            const extraAmt = extraCount * entryPrice;
            const baseAmt = Math.max(0, due - extraAmt);

            memberStats[mId].totalDue = Math.round((memberStats[mId].totalDue + due) * 100) / 100;
            memberStats[mId].extraTiffins += extraCount;
            memberStats[mId].extraTotal = Math.round((memberStats[mId].extraTotal + extraAmt) * 100) / 100;
            memberStats[mId].baseTotal = Math.round((memberStats[mId].baseTotal + baseAmt) * 100) / 100;
            memberStats[mId].mealsCount += 1;
          }
        }
      });
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

// GET /api/tiffin/groups/:id/entries — get entries for a group
router.get('/groups/:id/entries', auth, async (req, res) => {
  try {
    const groupId = req.params.id;
    const { month } = req.query;
    let query = { groupId };
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      const [year, m] = month.split('-').map(Number);
      const start = new Date(year, m - 1, 1);
      const end = new Date(year, m, 1);
      query.date = { $gte: start, $lt: end };
    }
    const entries = await TiffinEntry.find(query).sort({ date: -1, createdAt: -1 });
    return res.json(entries);
  } catch (err) {
    console.error('GET /api/tiffin/groups/:id/entries error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

// POST /api/tiffin/groups/:id/entries — create a meal entry or "no tiffin today"
router.post('/groups/:id/entries', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const groupId = req.params.id;
    const { mealType, count, quantity, baseQuantity, splitMemberIds, extras, extraPrice, notes, date, noTiffin, participants, memberBills: clientMemberBills } = req.body;

    const group = await TiffinGroup.findById(groupId);
    if (!group) return res.status(404).json({ message: 'Group not found' });

    const isNoMeal = noTiffin === true || mealType === 'none' || count === 0 || quantity === 0;
    const normalizedMeal = isNoMeal ? 'none' : (mealType || 'lunch').toLowerCase();
    const pricePerUnit = Number(group.pricePerTiffin || group.defaultPrice || 100);

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
        ? splitMemberIds.map(String)
        : group.members.map((m, idx) => String(m._id || m.userId || idx));

      const extraTiffinsTotal = Object.values(extrasMap).reduce((s, k) => s + (parseInt(k, 10) || 0), 0);
      mealCount = baseQty + extraTiffinsTotal;
      const extraVal = parseFloat(extraPrice) || 0;
      totalPrice = (baseQty * pricePerUnit) + (extraTiffinsTotal * pricePerUnit) + extraVal;

      // Calculate member bills (support client passed bills or derive evenly)
      const basePerPerson = splitIds.length > 0 ? (baseQty * pricePerUnit) / splitIds.length : 0;
      group.members.forEach((m, idx) => {
        const mId = String(m._id || m.userId);
        const idxStr = String(idx);
        let bill = 0;

        if (clientMemberBills && (clientMemberBills[mId] !== undefined || clientMemberBills[idxStr] !== undefined)) {
          bill = parseFloat(clientMemberBills[mId] ?? clientMemberBills[idxStr]) || 0;
        } else {
          const isParticipant = splitIds.includes(mId) || splitIds.includes(idxStr) || splitIds.includes(String(m.userId)) || splitIds.includes(String(m._id));
          bill = isParticipant ? basePerPerson : 0;
          const userExtra = extrasMap[mId] ?? extrasMap[idxStr] ?? 0;
          if (userExtra) {
            bill += (parseInt(userExtra, 10) || 0) * pricePerUnit;
          }
        }
        memberBills[mId] = Math.round(bill * 100) / 100;
        memberBills[idxStr] = Math.round(bill * 100) / 100;
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
      pricePerTiffin: pricePerUnit,
      totalCost: totalPrice,
      totalPrice,
      participantMemberIds: splitIds,
      splitMemberIds: splitIds,
      extras: extrasMap,
      memberBills,
      extraPrice: isNoMeal ? 0 : (parseFloat(extraPrice) || 0),
      noTiffin: isNoMeal,
      participants: Array.isArray(participants) ? participants : [],
      notes: isNoMeal ? (notes || 'No one took tiffin today') : (notes || ''),
    });

    // Auto-sync into Expense Tracker if user or member has autoSyncTiffin enabled
    if (!isNoMeal && entry.memberBills) {
      try {
        for (let idx = 0; idx < group.members.length; idx++) {
          const m = group.members[idx];
          const mId = String(m._id || m.userId);
          const idxStr = String(idx);
          const due = memberBills[mId] ?? memberBills[idxStr] ?? 0;
          if (due > 0) {
            let targetUser = null;
            if (m.userId) {
              targetUser = await User.findById(m.userId);
            } else if (m.email) {
              targetUser = await User.findOne({ email: m.email.toLowerCase().trim() });
            }
            const isCreatorMember = (m.userId && String(m.userId) === String(group.createdBy)) ||
              (!m.userId && (String(m.name || '').toLowerCase() === 'you' || String(m.name || '').toLowerCase() === 'me' || idx === 0));
            if (!targetUser && isCreatorMember) {
              targetUser = await User.findById(group.createdBy);
            }

            if (targetUser && targetUser.autoSyncTiffin) {
              let tiffinCat = await Category.findOne({ userId: targetUser._id, name: 'Tiffin Expense' });
              if (!tiffinCat) {
                tiffinCat = await Category.create({
                  userId: targetUser._id,
                  name: 'Tiffin Expense',
                  limit: 5000,
                  color: '#ea580c',
                  icon: 'restaurant-outline',
                  isDefault: false,
                });
              }

              const syncRef = `tiffin_${entry._id}_${groupId}_${mId}`;
              await Expense.findOneAndUpdate(
                { syncRefId: syncRef },
                {
                  userId: targetUser._id,
                  title: `Tiffin: ${normalizedMeal.charAt(0).toUpperCase() + normalizedMeal.slice(1)} (${group.name})`,
                  amount: due,
                  category: 'Tiffin Expense',
                  categoryId: tiffinCat._id,
                  date: entry.date || new Date(),
                  paymentMethod: 'UPI',
                  notes: `Group: ${group.name} · Share: ₹${due}${entry.notes ? ` · ${entry.notes}` : ''}`,
                  syncSource: 'tiffin',
                  syncRefId: syncRef,
                },
                { upsert: true, new: true }
              );
            }
          }
        }
      } catch (syncErr) {
        console.error('Tiffin auto-sync to expenses error:', syncErr);
      }
    }


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
    // Clean up synced Expense from Expense Tracker
    await Expense.deleteMany({
      $or: [
        { syncRefId: `tiffin_${entryId}_${groupId}` },
        { syncRefId: `tiffin_${entryId}` },
      ],
    }).catch(() => {});
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
