const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const SplitGroup = require('../models/SplitGroup');
const SplitExpense = require('../models/SplitExpense');
const User = require('../models/User');
const Category = require('../models/Category');
const Expense = require('../models/Expense');

// ── Web ⇄ mobile shape bridge ─────────────────────────────────────────────────
// The web app (myExpense) stores SplitExpense docs in its own shape:
//   { title, amount, paidBy, splits: [{ userId, shareAmount, status }] }
// The mobile app consumes the legacy shape:
//   { title|description, amount, paidBy, splitBetween: [{ userId, amount }], isSettled, date }
// These helpers translate at READ time (stored documents are never rewritten)
// and build BOTH shapes together on WRITE so each app reads its native format.

const idStr = (v) => {
  if (v && typeof v === 'object') return String(v._id ?? v.userId ?? '');
  return v === undefined || v === null ? '' : String(v);
};

const round2 = (n) => Math.round(Number(n) * 100) / 100;

/** Shares of an expense in mobile form, preferring the web `splits` ledger. */
function sharesOf(exp) {
  const obj = exp.toObject ? exp.toObject() : { ...exp };
  if (Array.isArray(obj.splits) && obj.splits.length > 0) {
    return obj.splits.map((s) => ({
      userId: s.userId,
      amount: Number(s.shareAmount) || 0,
      status: s.status || 'unpaid',
      transactionId: s.transactionId,
    }));
  }
  return (Array.isArray(obj.splitBetween) ? obj.splitBetween : []).map((s) => ({
    userId: s.userId,
    amount: Number(s.amount) || 0,
    status: s.status || 'unpaid',
    transactionId: s.transactionId,
  }));
}

/** Normalized expense for mobile consumers (keeps every original field too). */
function toMobileSplitExpense(exp, groupMap) {
  const obj = exp.toObject ? exp.toObject() : { ...exp };
  const title = obj.title || obj.description || 'Shared Expense';
  obj.title = title;
  if (!obj.description) obj.description = title;
  const shares = sharesOf(exp);
  if (!Array.isArray(obj.splitBetween) || obj.splitBetween.length === 0) {
    obj.splitBetween = shares;
  }
  if (obj.isSettled === undefined || obj.isSettled === null) {
    obj.isSettled = shares.length > 0 && shares.every((s) => s.status === 'paid');
  }
  if (!obj.date) obj.date = obj.createdAt || new Date().toISOString();
  if (groupMap) obj.groupName = groupMap[String(obj.groupId)] || 'Split Group';
  return obj;
}

/**
 * Recompute `cachedBalances` for a group with the same pairwise net-debt
 * model the web app uses (unpaid shares count, paid shares don't, completed
 * group-level settlements reduce debt). Port of myExpense balanceEngine.
 */
async function recomputeSplitBalances(groupId) {
  try {
    const oid = new (require('mongoose').Types.ObjectId)(String(groupId));
    const [expenses, settlements] = await Promise.all([
      SplitExpense.find({ groupId: oid }).lean(),
      mongooseConnection()
        .collection('splitsettlements')
        .find({ groupId: oid, status: 'completed' })
        .toArray()
        .catch(() => []),
    ]);

    const raw = {};
    const add = (from, to, amt) => {
      if (!from || !to || from === to) return;
      if (!raw[from]) raw[from] = {};
      raw[from][to] = (raw[from][to] || 0) + amt;
    };

    for (const exp of expenses) {
      const payerId = idStr(exp.paidBy);
      for (const share of sharesOf(exp)) {
        if (share.status === 'paid') continue;
        add(idStr(share.userId), payerId, share.amount);
      }
    }
    for (const st of settlements) {
      if (st.expenseId) continue;
      add(idStr(st.fromUser), idStr(st.toUser), -Number(st.amount || 0));
    }

    const balances = {};
    for (const from of Object.keys(raw)) {
      for (const to of Object.keys(raw[from])) {
        const net = Math.round((raw[from][to] || 0) - (raw[to]?.[from] || 0));
        if (net > 0.5) {
          balances[from] = (balances[from] || 0) - net;
          balances[to] = (balances[to] || 0) + net;
        }
      }
    }

    await SplitGroup.updateOne({ _id: oid }, { $set: { cachedBalances: balances } });
    return balances;
  } catch (err) {
    console.error('recomputeSplitBalances error:', err.message);
    return {};
  }
}

function mongooseConnection() {
  return require('mongoose').connection;
}

// Equal split with remainder distribution — same math as web calculateEqualSplit
function equalSplitShares(amount, memberIds) {
  const n = memberIds.length;
  if (n === 0) return [];
  const total = round2(amount);
  const base = Math.floor((total * 100) / n) / 100;
  const remainderCents = Math.round(total * 100) - Math.round(base * 100) * n;
  return memberIds.map((id, idx) => ({
    userId: id,
    shareAmount: round2(base + (idx < remainderCents ? 0.01 : 0)),
    status: 'unpaid',
  }));
}

// GET /api/split/summary
router.get('/summary', auth, async (req, res) => {
  try {
    const userId = String(req.user.id);

    // Owed to me: my unpaid shares in expenses I did NOT pay for
    const splitForMe = await SplitExpense.find({
      paidBy: { $ne: userId },
      $or: [{ 'splits.userId': userId }, { 'splitBetween.userId': userId }],
    });
    let totalYouOwe = 0;
    splitForMe.forEach((exp) => {
      const mine = sharesOf(exp).find((s) => idStr(s.userId) === userId);
      if (mine && mine.status !== 'paid') totalYouOwe += mine.amount;
    });

    // I owe nobody for expenses I paid — others' unpaid shares are owed to me
    const paidByMe = await SplitExpense.find({ paidBy: userId });
    let totalOwedToYou = 0;
    paidByMe.forEach((exp) => {
      sharesOf(exp).forEach((s) => {
        if (idStr(s.userId) && idStr(s.userId) !== userId && s.status !== 'paid') {
          totalOwedToYou += s.amount;
        }
      });
    });

    return res.json({
      totalOwedToYou: round2(totalOwedToYou),
      totalYouOwe: round2(totalYouOwe),
      netBalance: round2(totalOwedToYou - totalYouOwe),
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
      title: description, // web reads `title` — dual-write so both apps see it
      description,
      amount: parseFloat(amount),
      paidBy: userId,
      splitBetween,
      date: date ? new Date(date) : new Date(),
    });

    // Auto-sync into Expense Tracker if participant has autoSyncSplit enabled
    try {
      for (const split of splitBetween) {
        if (split.userId && split.amount > 0) {
          const targetUser = await User.findById(split.userId);
          if (targetUser && targetUser.autoSyncSplit) {
            let splitCat = await Category.findOne({ userId: targetUser._id, name: 'Split Expense' });
            if (!splitCat) {
              splitCat = await Category.create({
                userId: targetUser._id,
                name: 'Split Expense',
                limit: 5000,
                color: '#8b5cf6',
                icon: 'people-outline',
                isDefault: false,
              });
            }

            await Expense.create({
              userId: targetUser._id,
              title: `Split: ${description} (${group.name})`,
              amount: split.amount,
              category: 'Split Expense',
              categoryId: splitCat._id,
              date: expense.date || new Date(),
              paymentMethod: String(expense.paidBy) === String(targetUser._id) ? 'Paid by You' : 'Split Share',
              notes: `Auto-synced from Split Bills: ${group.name}`,
            });
          }
        }
      }
    } catch (syncErr) {
      console.error('Split auto-sync to expenses error:', syncErr);
    }

    return res.status(201).json(expense);
  } catch (err) {
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

// ── Mobile endpoints (mirror the web's split contract) ────────────────────────

// GET /api/split/expenses?groupId= — list one group's expenses (mobile shape)
router.get('/expenses', auth, async (req, res) => {
  try {
    const userId = String(req.user.id);
    const { groupId } = req.query;
    if (!groupId) return res.status(400).json({ message: 'groupId is required' });

    const group = await SplitGroup.findById(groupId);
    if (!group) return res.status(404).json({ message: 'Group not found' });
    const isMember =
      String(group.createdBy) === userId ||
      group.members.some((m) => m.userId && String(m.userId) === userId);
    if (!isMember) return res.status(404).json({ message: 'Group not found or access denied' });

    const expenses = await SplitExpense.find({ groupId })
      .populate('paidBy', 'name avatar')
      .populate('splits.userId', 'name avatar')
      .sort({ createdAt: -1 })
      .limit(200);

    return res.json(expenses.map((e) => toMobileSplitExpense(e)));
  } catch (err) {
    console.error('GET /api/split/expenses error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

// POST /api/split/expenses — add a bill from mobile (writes the web's native shape)
router.post('/expenses', auth, async (req, res) => {
  try {
    const userId = String(req.user.id);
    const {
      groupId,
      title,
      description,
      amount,
      paidBy,
      splitBetween,
      includedMemberIds,
      category,
      date,
    } = req.body;

    const finalTitle = String(title || description || '').trim();
    const finalAmount = round2(parseFloat(amount));
    if (!groupId || !finalTitle || !finalAmount || finalAmount < 1) {
      return res.status(400).json({ message: 'groupId, title and amount (≥ 1) are required' });
    }

    const group = await SplitGroup.findById(groupId);
    if (!group) return res.status(404).json({ message: 'Group not found' });
    const memberIds = group.members
      .filter((m) => m.userId)
      .map((m) => String(m.userId));
    const isMember = String(group.createdBy) === userId || memberIds.includes(userId);
    if (!isMember) return res.status(404).json({ message: 'Group not found or you are not a member' });

    // Participants: explicit splitBetween userIds > includedMemberIds > all members
    let participantIds = [];
    if (Array.isArray(splitBetween) && splitBetween.length > 0) {
      participantIds = splitBetween.map((s) => idStr(s.userId || s)).filter(Boolean);
    } else if (Array.isArray(includedMemberIds) && includedMemberIds.length > 0) {
      participantIds = includedMemberIds.map(String);
    } else {
      participantIds = memberIds;
    }
    participantIds = [...new Set(participantIds)].filter((id) => memberIds.includes(id));
    if (participantIds.length === 0) participantIds = memberIds.length > 0 ? memberIds : [userId];

    const payerId = paidBy && memberIds.includes(String(paidBy)) ? String(paidBy) : userId;

    // Prefer client per-member amounts when provided, else equal split
    let splits;
    if (Array.isArray(splitBetween) && splitBetween.length > 0) {
      const clientAmounts = new Map();
      splitBetween.forEach((s) => {
        const id = idStr(s.userId || s);
        if (id) clientAmounts.set(id, round2(parseFloat(s.amount) || 0));
      });
      if (participantIds.every((id) => clientAmounts.get(id) > 0)) {
        splits = participantIds.map((id) => ({
          userId: id,
          shareAmount: clientAmounts.get(id),
          status: 'unpaid',
        }));
      }
    }
    if (!splits) splits = equalSplitShares(finalAmount, participantIds);
    splits = splits.map((s) => ({
      ...s,
      status: idStr(s.userId) === payerId ? 'paid' : 'unpaid',
    }));

    const expense = await SplitExpense.create({
      groupId,
      paidBy: payerId,
      title: finalTitle,
      description: finalTitle, // legacy/mobile field
      amount: finalAmount,
      category: category || undefined,
      splitType: 'equal',
      splits,
      splitBetween: splits.map((s) => ({ userId: s.userId, amount: s.shareAmount, status: s.status })),
      date: date ? new Date(date) : new Date(),
      disputeWindowEndsAt: new Date(Date.now() + 24 * 3600 * 1000),
    });

    // Mirror the web's personal tracker sync: every non-payer gets an Expense
    // row (sourceType 'split') in their own tracker — best effort, non-fatal.
    try {
      for (const s of splits) {
        const memberUserId = idStr(s.userId);
        if (!memberUserId || memberUserId === payerId || s.shareAmount <= 0) continue;

        let cat = await Category.findOne({ userId: memberUserId, name: 'Split Expenses' });
        if (!cat) {
          cat = await Category.findOne({ userId: memberUserId });
        }
        const personal = await Expense.create({
          userId: memberUserId,
          amount: s.shareAmount,
          categoryId: cat ? cat._id : undefined,
          category: cat ? cat.name : 'Split',
          title: `${finalTitle} (split)`,
          date: new Date(),
          paymentMethod: 'UPI',
          notes: `Group: ${group.name}`,
          sourceType: 'split',
          splitGroupId: group._id,
          splitExpenseId: expense._id,
        });
        await SplitExpense.updateOne(
          { _id: expense._id, 'splits.userId': s.userId },
          { $set: { 'splits.$.transactionId': personal._id } }
        ).catch(() => {});
      }
    } catch (syncErr) {
      console.error('Split personal-sync error:', syncErr.message);
    }

    await recomputeSplitBalances(groupId);

    const populated = await SplitExpense.findById(expense._id)
      .populate('paidBy', 'name avatar')
      .populate('splits.userId', 'name avatar');
    return res.status(201).json(toMobileSplitExpense(populated || expense));
  } catch (err) {
    console.error('POST /api/split/expenses error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

// PUT /api/split/expenses/:id/settle — mark the whole bill settled (mobile)
router.put('/expenses/:id/settle', auth, async (req, res) => {
  try {
    const userId = String(req.user.id);
    const expense = await SplitExpense.findById(req.params.id);
    if (!expense) return res.status(404).json({ message: 'Expense not found' });

    const group = await SplitGroup.findById(expense.groupId);
    const isMember =
      group &&
      (String(group.createdBy) === userId ||
        group.members.some((m) => m.userId && String(m.userId) === userId));
    if (!isMember) return res.status(404).json({ message: 'Group not found or access denied' });

    // Whole-expense settle: every share becomes paid in BOTH representations
    expense.splits.forEach((s) => {
      s.status = 'paid';
    });
    if (Array.isArray(expense.splitBetween)) {
      expense.splitBetween.forEach((s) => {
        if (s) s.status = 'paid';
      });
    }
    expense.isSettled = true;
    await expense.save();

    await recomputeSplitBalances(expense.groupId);

    const populated = await SplitExpense.findById(expense._id)
      .populate('paidBy', 'name avatar')
      .populate('splits.userId', 'name avatar');
    return res.json(toMobileSplitExpense(populated || expense));
  } catch (err) {
    console.error('PUT /api/split/expenses/:id/settle error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

// GET /api/split/groups/all/expenses — every expense across the user's groups
router.get('/groups/all/expenses', auth, async (req, res) => {
  try {
    const userId = String(req.user.id);
    const groups = await SplitGroup.find({
      archived: { $ne: true },
      $or: [{ createdBy: userId }, { 'members.userId': userId }],
    }).select('_id name');

    if (groups.length === 0) return res.json([]);

    const groupMap = {};
    groups.forEach((g) => {
      groupMap[String(g._id)] = g.name;
    });

    const expenses = await SplitExpense.find({ groupId: { $in: groups.map((g) => g._id) } })
      .populate('paidBy', 'name avatar')
      .populate('splits.userId', 'name avatar')
      .sort({ createdAt: -1 })
      .limit(200);

    return res.json(expenses.map((e) => toMobileSplitExpense(e, groupMap)));
  } catch (err) {
    console.error('GET /api/split/groups/all/expenses error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

module.exports = router;
// Pure helpers exposed for unit tests (no DB required)
module.exports._helpers = { toMobileSplitExpense, sharesOf, equalSplitShares, idStr, round2 };
