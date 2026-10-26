const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const TiffinGroup = require('../models/TiffinGroup');
const TiffinEntry = require('../models/TiffinEntry');
const User = require('../models/User');
const Category = require('../models/Category');
const Expense = require('../models/Expense');
// Shared billing math (also used by routes/expenses.js to reconcile the
// Expense Tracker's Tiffin category against the Tiffin Tracker itself)
const {
  round2,
  calculateEntryBills,
  sanitizeSplitPayload,
  normalizeEntryForClient,
  toUtcMidnight,
} = require('../lib/tiffinBills');

function tiffinEntrySyncRefPattern(entryId, groupId) {
  const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^tiffin_${escapeRegex(entryId)}_${escapeRegex(groupId)}(?:_|$)`);
}

async function removeTiffinEntryExpenses(entryId, groupId) {
  await Expense.deleteMany({
    $or: [
      { syncRefId: tiffinEntrySyncRefPattern(entryId, groupId) },
      { syncRefId: `tiffin_${entryId}` },
    ],
  });
}

async function syncTiffinEntryExpenses(entry, group) {
  const activeSyncRefs = [];
  const normalizedMeal = String(entry.mealType || 'meal');
  const entryBills = calculateEntryBills(
    entry,
    entry.pricePerTiffin || group.pricePerTiffin || group.defaultPrice,
    group.members
  );

  if (!entry.noTiffin && normalizedMeal !== 'none') {
    for (let idx = 0; idx < group.members.length; idx++) {
      const member = group.members[idx];
      const memberId = String(member._id || member.userId || idx);
      const due = Number(
        entryBills[memberId] ??
          (member.userId ? entryBills[String(member.userId)] : undefined) ??
          entryBills[String(idx)] ??
          0
      );
      if (!Number.isFinite(due) || due <= 0) continue;

      let targetUser = null;
      if (member.userId) {
        targetUser = await User.findById(member.userId);
      } else if (member.email) {
        targetUser = await User.findOne({ email: member.email.toLowerCase().trim() });
      }

      const isCreatorMember =
        (member.userId && String(member.userId) === String(group.createdBy)) ||
        (!member.userId &&
          (['you', 'me'].includes(String(member.name || '').toLowerCase()) || idx === 0));
      if (!targetUser && isCreatorMember) {
        targetUser = await User.findById(group.createdBy);
      }
      if (!targetUser?.autoSyncTiffin) continue;

      let tiffinCategory = await Category.findOne({
        userId: targetUser._id,
        name: 'Tiffin Expense',
      });
      if (!tiffinCategory) {
        tiffinCategory = await Category.create({
          userId: targetUser._id,
          name: 'Tiffin Expense',
          color: '#ea580c',
          icon: 'restaurant-outline',
          isDefault: false,
        });
      }

      const syncRef = `tiffin_${entry._id}_${group._id}_${memberId}`;
      activeSyncRefs.push(syncRef);
      await Expense.findOneAndUpdate(
        { userId: targetUser._id, syncRefId: syncRef },
        {
          userId: targetUser._id,
          title: `Tiffin: ${normalizedMeal.charAt(0).toUpperCase()}${normalizedMeal.slice(1)} (${group.name})`,
          amount: round2(due),
          category: 'Tiffin Expense',
          categoryId: tiffinCategory._id,
          date: entry.date || new Date(),
          paymentMethod: 'UPI',
          notes: `Group: ${group.name} · Share: ₹${round2(due)}${entry.notes ? ` · ${entry.notes}` : ''}`,
          syncSource: 'tiffin',
          syncRefId: syncRef,
        },
        { upsert: true, new: true }
      );
    }
  }

  const syncRefPattern = tiffinEntrySyncRefPattern(entry._id, group._id);
  await Expense.deleteMany({
    syncRefId: {
      $regex: syncRefPattern,
      $nin: activeSyncRefs,
    },
  });
}

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
      // Read-time bridge so web-created entries (totalCost /
      // participantQuantities) render fully on mobile — stored docs untouched.
      entries: monthEntries.map((e) => normalizeEntryForClient(e, group.members, pricePerUnit)),
      allEntries: entries.map((e) => normalizeEntryForClient(e, group.members, pricePerUnit)),
      todayEntries: todayEntries.map((e) => normalizeEntryForClient(e, group.members, pricePerUnit)),
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
    const group = await TiffinGroup.findById(groupId);
    const members = group && Array.isArray(group.members) ? group.members : [];
    const pricePerUnit = group
      ? Number(group.pricePerTiffin || group.defaultPrice || 100)
      : 100;
    return res.json(
      entries.map((e) => normalizeEntryForClient(e, members, pricePerUnit))
    );
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

    // Date-only value stored as UTC midnight — the exact calendar-day key the
    // web app uses — so the (groupId, date, mealType) index and the month
    // filters of both apps agree on which day an entry belongs to.
    const entryDate = toUtcMidnight(date);

    let mealCount = 0;
    let totalPrice = 0;
    let memberBills = {};
    let splitIds = [];
    let extrasMap = {};

    if (!isNoMeal) {
      const baseQty = baseQuantity !== undefined
        ? parseInt(baseQuantity, 10)
        : (parseInt(quantity || count, 10) || 1);

      // Keep ONLY real member ids (mobile used to send `_id` + `userId` +
      // array-index variants which divided the base cost by 3× members).
      const sanitized = sanitizeSplitPayload({ baseQuantity: baseQty, splitMemberIds, extras }, group);
      if (sanitized) {
        splitIds = sanitized.splitMemberIds;
        extrasMap = sanitized.extras;
      } else {
        const validIds = new Set(group.members.map((m) => String(m._id)));
        splitIds = [...new Set((Array.isArray(splitMemberIds) ? splitMemberIds : []).map(String))]
          .filter((id) => validIds.has(id));
        if (splitIds.length === 0) {
          splitIds = group.members.map((m, idx) => String(m._id || m.userId || idx));
        }
        Object.entries(extras || {}).forEach(([id, k]) => {
          const q = Math.max(0, Math.floor(Number(k) || 0));
          if (q > 0 && validIds.has(id)) extrasMap[id] = (extrasMap[id] || 0) + q;
        });
      }

      const extraTiffinsTotal = Object.values(extrasMap).reduce((s, k) => s + (parseInt(k, 10) || 0), 0);
      mealCount = baseQty + extraTiffinsTotal;
      const extraVal = parseFloat(extraPrice) || 0;
      totalPrice = (baseQty * pricePerUnit) + (extraTiffinsTotal * pricePerUnit) + extraVal;

      // Calculate member bills (support client passed bills or derive evenly).
      // Canonical key = member-subdoc id — that's what the mobile chips and the
      // web's member summary look up (numeric-index keys would render as
      // duplicate "Member" chips).
      const basePerPerson = splitIds.length > 0 ? (baseQty * pricePerUnit) / splitIds.length : 0;
      group.members.forEach((m, idx) => {
        const mId = String(m._id || m.userId);
        const idxStr = String(idx);
        let bill = 0;

        if (clientMemberBills && (clientMemberBills[mId] !== undefined || clientMemberBills[idxStr] !== undefined)) {
          bill = parseFloat(clientMemberBills[mId] ?? clientMemberBills[idxStr]) || 0;
        } else {
          const isParticipant = splitIds.includes(mId) || splitIds.includes(String(m.userId)) || splitIds.includes(String(m._id));
          bill = isParticipant ? basePerPerson : 0;
          const userExtra = extrasMap[mId] ?? extrasMap[idxStr] ?? 0;
          if (userExtra) {
            bill += (parseInt(userExtra, 10) || 0) * pricePerUnit;
          }
        }
        memberBills[mId] = Math.round(bill * 100) / 100;
      });
    }

    // One entry per group per meal per calendar day — same rule the web app
    // enforces via its unique index. Return 409 (like the web) instead of
    // letting a duplicate slip through or blowing up with a 500.
    const existingSameDay = await TiffinEntry.findOne({
      groupId,
      date: entryDate,
      mealType: normalizedMeal,
    });
    if (existingSameDay) {
      return res.status(409).json({
        message: `A ${normalizedMeal} record already exists for this date — edit it instead`,
        entryId: existingSameDay._id,
      });
    }

    const participantCount = new Set(splitIds.map(String)).size;
    const perPersonShare =
      !isNoMeal && participantCount > 0 ? round2(totalPrice / participantCount) : 0;

    let entry;
    try {
      entry = await TiffinEntry.create({
        groupId,
        userId,
        addedBy: userId,
        date: entryDate,
        mealType: normalizedMeal,
        count: mealCount,
        quantity: mealCount,
        baseQuantity: isNoMeal ? 0 : (baseQuantity || mealCount),
        pricePerTiffin: pricePerUnit,
        totalCost: totalPrice,
        totalPrice,
        perPersonShare,
        participantMemberIds: splitIds,
        splitMemberIds: splitIds,
        participantQuantities: extrasMap,
        extras: extrasMap,
        memberBills,
        extraPrice: isNoMeal ? 0 : (parseFloat(extraPrice) || 0),
        noTiffin: isNoMeal,
        participants: Array.isArray(participants) ? participants : [],
        notes: isNoMeal ? (notes || 'No one took tiffin today') : (notes || ''),
        source: 'manual',
      });
    } catch (createErr) {
      if (createErr && createErr.code === 11000) {
        return res.status(409).json({
          message: 'A record already exists for this date — edit it instead',
          entryId: null,
        });
      }
      throw createErr;
    }

    // Auto-sync into Expense Tracker if user or member has autoSyncTiffin enabled
    if (!isNoMeal && entry.memberBills) {
      try {
        await syncTiffinEntryExpenses(entry, group);
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
    const pricePerUnit = group.pricePerTiffin || group.defaultPrice || 80;

    if (isNoMeal) {
      entry.noTiffin = true;
      entry.mealType = 'none';
      entry.count = 0;
      entry.quantity = 0;
      entry.baseQuantity = 0;
      entry.extras = {};
      entry.participantQuantities = {};
      entry.memberBills = {};
      entry.extraPrice = 0;
      entry.totalPrice = 0;
      entry.totalCost = 0;
      entry.perPersonShare = 0;
      entry.participantMemberIds = [];
      entry.splitMemberIds = [];
      entry.notes = notes || 'No one took tiffin today';
    } else {
      entry.noTiffin = false;
      if (mealType) entry.mealType = mealType.toLowerCase();

      const baseQty = baseQuantity !== undefined
        ? parseInt(baseQuantity, 10)
        : (parseInt(quantity || count || entry.baseQuantity || 1, 10));

      const validIds = new Set(group.members.map((m) => String(m._id)));
      const previousSplitIds =
        (Array.isArray(entry.splitMemberIds) && entry.splitMemberIds.length > 0
          ? entry.splitMemberIds
          : entry.participantMemberIds) || [];
      const previousExtras =
        Object.keys(entry.extras || {}).length > 0
          ? entry.extras
          : (entry.participantQuantities || {});

      const sanitized = sanitizeSplitPayload(
        {
          baseQuantity: baseQty,
          splitMemberIds:
            Array.isArray(splitMemberIds) && splitMemberIds.length > 0
              ? splitMemberIds
              : previousSplitIds,
          extras: extras !== undefined ? extras : previousExtras,
        },
        group
      );

      let splitIds;
      let extrasMap;
      if (sanitized) {
        splitIds = sanitized.splitMemberIds;
        extrasMap = sanitized.extras;
      } else {
        splitIds = [...new Set(previousSplitIds.map(String))].filter((id) => validIds.has(id));
        if (splitIds.length === 0) {
          splitIds = group.members.map((m, idx) => String(m._id || m.userId || idx));
        }
        extrasMap = {};
        Object.entries(previousExtras || {}).forEach(([id, k]) => {
          const q = Math.max(0, Math.floor(Number(k) || 0));
          if (q > 0 && validIds.has(id)) extrasMap[id] = (extrasMap[id] || 0) + q;
        });
      }

      const extraTiffinsTotal = Object.values(extrasMap).reduce((s, k) => s + (parseInt(k, 10) || 0), 0);
      const totalQty = baseQty + extraTiffinsTotal;

      entry.count = totalQty;
      entry.quantity = totalQty;
      entry.baseQuantity = baseQty;
      entry.splitMemberIds = splitIds;
      // Web reads `participantMemberIds` — must follow every edit
      entry.participantMemberIds = splitIds;
      entry.extras = extrasMap;
      entry.participantQuantities = extrasMap;

      const extraVal = extraPrice !== undefined ? parseFloat(extraPrice) || 0 : (entry.extraPrice || 0);
      entry.extraPrice = extraVal;
      const newTotal = (baseQty * pricePerUnit) + (extraTiffinsTotal * pricePerUnit) + extraVal;
      entry.totalPrice = newTotal;
      entry.totalCost = newTotal;
      const participantCount = new Set(splitIds.map(String)).size;
      entry.perPersonShare = participantCount > 0 ? round2(newTotal / participantCount) : 0;

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

    if (date) entry.date = toUtcMidnight(date);
    entry.editedAt = new Date();
    await entry.save();

    try {
      await syncTiffinEntryExpenses(entry, group);
    } catch (syncErr) {
      console.error('Tiffin expense sync after edit error:', syncErr);
    }

    return res.json(normalizeEntryForClient(entry, group.members, pricePerUnit));
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
    // Canonical refs include the member id, so remove all member rows too.
    await removeTiffinEntryExpenses(entryId, groupId);
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
      groupMap[String(g._id)] = {
        name: g.name,
        price: Number(g.pricePerTiffin || g.defaultPrice || 100),
      };
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

    const formatted = entries.map((e) => {
      const info = groupMap[String(e.groupId)] || { name: 'Tiffin Group', price: 100 };
      const price = Number(e.pricePerTiffin || info.price || 100);
      const count = e.count ?? e.quantity ?? 1;
      // Web-created entries carry totalCost only; mobile reads totalPrice
      const total = e.totalPrice ?? e.totalCost ?? Math.round(count * price * 100) / 100;
      return {
        _id: e._id,
        groupId: e.groupId,
        groupName: info.name || 'Tiffin Group',
        date: e.date,
        mealType: e.mealType || 'lunch',
        count,
        quantity: e.quantity ?? e.count ?? 1,
        extraPrice: e.extraPrice || 0,
        totalPrice: total,
        totalCost: total,
        baseQuantity: e.baseQuantity,
        extras: e.extras && Object.keys(e.extras).length > 0 ? e.extras : (e.participantQuantities || {}),
        noTiffin: e.noTiffin || e.mealType === 'none',
        notes: e.notes || '',
        participants: e.participants || [],
      };
    });

    return res.json(formatted);
  } catch (err) {
    console.error('GET /api/tiffin/transactions error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

module.exports = router;
// Pure helpers exposed for unit tests (no DB required)
module.exports._helpers = {
  sanitizeSplitPayload,
  normalizeEntryForClient,
  toUtcMidnight,
  round2,
  tiffinEntrySyncRefPattern,
};
