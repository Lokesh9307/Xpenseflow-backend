const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const User = require('../models/User');
const Category = require('../models/Category');
const Expense = require('../models/Expense');
const Budget = require('../models/Budget');
const RecurringExpense = require('../models/RecurringExpense');
const Income = require('../models/Income');
const TiffinGroup = require('../models/TiffinGroup');
const TiffinEntry = require('../models/TiffinEntry');
const SplitGroup = require('../models/SplitGroup');
const SplitExpense = require('../models/SplitExpense');
const { calculateEntryBills } = require('../lib/tiffinBills');

// GET /api/profile
router.get('/', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId).select('-password -otp');
    if (!user) return res.status(404).json({ message: 'User not found' });
    return res.json({ user });
  } catch (err) {
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

// PUT /api/profile
router.put('/', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const allowed = ['name', 'avatar', 'isOnboarded', 'currency', 'autoSyncTiffin', 'autoSyncSplit'];
    const update = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }

    // If autoSyncTiffin is enabled, auto-create "Tiffin Expense" category and backfill meals
    if (update.autoSyncTiffin === true) {
      let existingTiffinCat = await Category.findOne({ userId, name: 'Tiffin Expense' });
      if (!existingTiffinCat) {
        existingTiffinCat = await Category.create({
          userId,
          name: 'Tiffin Expense',
          color: '#ea580c',
          icon: 'restaurant-outline',
          isDefault: false,
        });
      }

      try {
        const tiffinGroups = await TiffinGroup.find({
          archived: { $ne: true },
          $or: [{ createdBy: userId }, { 'members.userId': userId }, { 'members.email': req.user.email }],
        });
        for (const g of tiffinGroups) {
          const entries = await TiffinEntry.find({ groupId: g._id, noTiffin: { $ne: true } });
          const userMember = g.members.find(
            (m) => String(m.userId) === userId ||
              (m.email && m.email.toLowerCase() === req.user.email?.toLowerCase()) ||
              (g.members.length === 1 && String(g.createdBy) === userId)
          );
          const mId = userMember ? String(userMember._id || userMember.userId) : userId;

          for (const e of entries) {
            let due = 0;
            const bills = calculateEntryBills(
              e,
              e.pricePerTiffin || g.pricePerTiffin || g.defaultPrice,
              g.members
            );
            const memberIndex = userMember ? g.members.indexOf(userMember) : -1;
            const billKeys = [mId, userId, memberIndex >= 0 ? String(memberIndex) : null].filter(Boolean);
            const billKey = billKeys.find((key) => Object.prototype.hasOwnProperty.call(bills, key));

            if (billKey !== undefined) {
              due = Number(bills[billKey]) || 0;
            } else {
              const total = Number(e.totalCost ?? e.totalPrice ?? 0);
              due = g.members.length > 1 ? total / g.members.length : total;
            }

            if (due > 0) {
              const syncRef = `tiffin_${e._id}_${g._id}_${mId}`;
              await Expense.findOneAndUpdate(
                { userId, syncRefId: syncRef },
                {
                  userId,
                  title: `Tiffin: ${(e.mealType || 'Meal').charAt(0).toUpperCase() + (e.mealType || 'Meal').slice(1)} (${g.name})`,
                  amount: Math.round(due * 100) / 100,
                  category: 'Tiffin Expense',
                  categoryId: existingTiffinCat._id,
                  date: e.date || e.createdAt,
                  paymentMethod: 'UPI',
                  notes: `Group: ${g.name} · Share: ₹${due}`,
                  syncSource: 'tiffin',
                  syncRefId: syncRef,
                },
                { upsert: true, new: true }
              );
            }
          }
        }
      } catch (err) {
        console.error('Backend autoSyncTiffin error:', err);
      }
    } else if (update.autoSyncTiffin === false) {
      try {
        await Expense.deleteMany({ userId, syncSource: 'tiffin' });
        await Expense.deleteMany({ userId, category: 'Tiffin Expense', notes: { $regex: /Auto-synced from Tiffin Tracker|Group: / } });
      } catch (e) {}
    }


    // If autoSyncSplit is enabled, auto-create "Split Expense" category and backfill bills
    if (update.autoSyncSplit === true) {
      let existingSplitCat = await Category.findOne({ userId, name: 'Split Expense' });
      if (!existingSplitCat) {
        existingSplitCat = await Category.create({
          userId,
          name: 'Split Expense',
          color: '#8b5cf6',
          icon: 'people-outline',
          isDefault: false,
        });
      }

      try {
        const splitGroups = await SplitGroup.find({
          $or: [{ createdBy: userId }, { 'members.userId': userId }, { 'members.email': req.user.email }],
        });
        for (const sg of splitGroups) {
          const splitExps = await SplitExpense.find({ groupId: sg._id });
          for (const se of splitExps) {
            const syncNote = `Auto-synced from Split Bills: ${sg.name} [split_${se._id}]`;
            const already = await Expense.findOne({ userId, notes: syncNote });
            if (!already) {
              let myShare = 0;
              if (Array.isArray(se.splitBetween)) {
                const mySplit = se.splitBetween.find((s) => String(s.userId) === userId);
                if (mySplit) myShare = mySplit.amount;
              }
              if (!myShare && sg.members.length > 0) {
                myShare = Math.round((se.amount / sg.members.length) * 100) / 100;
              }
              if (myShare > 0) {
                await Expense.create({
                  userId,
                  title: `Split: ${se.description || 'Shared Bill'} (${sg.name})`,
                  amount: myShare,
                  category: 'Split Expense',
                  categoryId: existingSplitCat._id,
                  date: se.date || se.createdAt,
                  paymentMethod: String(se.paidBy) === userId ? 'Paid by You' : 'Split Share',
                  notes: syncNote,
                });
              }
            }
          }
        }
      } catch (err) {
        console.error('Backend autoSyncSplit error:', err);
      }
    } else if (update.autoSyncSplit === false) {
      try {
        await Expense.deleteMany({ userId, category: 'Split Expense', notes: { $regex: /Auto-synced from Split Bills/ } });
      } catch (e) {}
    }

    const user = await User.findByIdAndUpdate(userId, { $set: update }, { new: true }).select(
      '-password -otp'
    );

    return res.json({ success: true, user });
  } catch (err) {
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

// POST /api/profile/reset-data - reset data
router.post('/reset-data', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { scope = 'expenses' } = req.body;

    // Reset expense tracker core data
    await Expense.deleteMany({ userId });
    await Budget.deleteMany({ userId });
    await RecurringExpense.deleteMany({ userId });
    await Income.deleteMany({ userId });

    // Reset categories to fresh defaults
    await Category.deleteMany({ userId });
    const defaults = [
      { name: 'Food & Dining', limit: 8000, color: '#A78BFA', icon: 'fast-food-outline' },
      { name: 'Shopping', limit: 5000, color: '#84CC16', icon: 'cart-outline' },
      { name: 'Travel & Commute', limit: 4000, color: '#38BDF8', icon: 'car-outline' },
      { name: 'Bills & Utilities', limit: 6000, color: '#F59E0B', icon: 'flash-outline' },
      { name: 'Entertainment', limit: 3000, color: '#F472B6', icon: 'film-outline' },
      { name: 'Others', limit: 3000, color: '#9CA3AF', icon: 'ellipsis-horizontal-outline' },
    ];
    await Category.insertMany(defaults.map((d) => ({ ...d, userId, isDefault: true })));

    if (scope === 'all') {
      // Also reset tiffin & split data
      await TiffinGroup.deleteMany({ createdBy: userId });
      await TiffinEntry.deleteMany({ userId });
      await SplitGroup.deleteMany({ createdBy: userId });
      await SplitExpense.deleteMany({ paidBy: userId });
    }

    return res.json({
      success: true,
      message: scope === 'all' ? 'All workspace data reset successfully' : 'Expense tracker data reset successfully',
    });
  } catch (err) {
    console.error('Reset data error:', err);
    return res.status(500).json({ message: err.message || 'Failed to reset data' });
  }
});

module.exports = router;
