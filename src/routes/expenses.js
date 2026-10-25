const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Expense = require('../models/Expense');
const Budget = require('../models/Budget');
const Category = require('../models/Category');

const { autoProcessRecurringExpenses } = require('./recurring');

// GET /api/expenses
router.get('/', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    if (typeof autoProcessRecurringExpenses === 'function') {
      await autoProcessRecurringExpenses(userId);
    }
    const { category, search, limit, sortBy, sortOrder, month } = req.query;

    const query = { userId };
    if (category && category !== 'All') {
      const trimmedCat = category.trim();
      const catDoc = await Category.findOne({
        userId,
        name: { $regex: new RegExp(`^${trimmedCat}$`, 'i') },
      });
      if (catDoc) {
        query.$or = [
          { category: { $regex: new RegExp(`^${trimmedCat}$`, 'i') } },
          { categoryId: catDoc._id },
        ];
      } else {
        query.category = { $regex: new RegExp(`^${trimmedCat}$`, 'i') };
      }
    }
    if (search) {
      query.title = { $regex: search, $options: 'i' };
    }
    if (month && month !== 'all') {
      const [year, m] = month.split('-').map(Number);
      if (year && m) {
        // Broad UTC/Local range to ensure all transactions in that month are returned
        const startOfMonth = new Date(Date.UTC(year, m - 1, 1, 0, 0, 0, 0));
        const endOfMonth = new Date(Date.UTC(year, m, 1, 0, 0, 0, 0)); // Start of next month
        query.date = { $gte: startOfMonth, $lt: endOfMonth };
      }
    }

    const sortField = sortBy || 'date';
    const sortDir = sortOrder === 'asc' ? 1 : -1;
    const maxLimit = limit ? parseInt(limit, 10) : 150;

    const rawExpenses = await Expense.find(query)
      .populate('categoryId', 'name color icon monthlyLimit limit')
      .sort({ [sortField]: sortDir })
      .limit(maxLimit);

    // Normalize expenses so web and mobile receive their expected fields without category loss
    const expenses = rawExpenses.map((exp) => {
      const obj = exp.toObject ? exp.toObject() : exp;
      let catName = obj.category;
      if (!catName || catName === 'Others') {
        if (obj.categoryId && typeof obj.categoryId === 'object' && obj.categoryId.name) {
          catName = obj.categoryId.name;
        }
      }
      return {
        ...obj,
        category: catName || 'Others',
        categoryId: obj.categoryId?._id || obj.categoryId,
        categoryDetails: obj.categoryId && typeof obj.categoryId === 'object' ? obj.categoryId : undefined,
      };
    });

    return res.json(expenses);
  } catch (err) {
    console.error('Fetch expenses error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

// POST /api/expenses
router.post('/', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { title, amount, category, categoryId, paymentMethod, date, notes, location } = req.body;

    if (!title || !amount) {
      return res.status(400).json({ message: 'Title and amount are required' });
    }

    const expenseDate = date ? new Date(date) : new Date();

    // Resolve categoryId and category name to guarantee full web & mobile schema compatibility
    let resolvedCategoryId = categoryId;
    let resolvedCategoryName = category;

    if (resolvedCategoryId) {
      const catDoc = await Category.findById(resolvedCategoryId);
      if (catDoc) {
        resolvedCategoryName = catDoc.name;
      }
    } else if (resolvedCategoryName) {
      let catDoc = await Category.findOne({
        userId,
        name: { $regex: new RegExp(`^${resolvedCategoryName.trim()}$`, 'i') },
      });
      if (!catDoc) {
        catDoc = await Category.create({
          userId,
          name: resolvedCategoryName.trim(),
          limit: 5000,
          monthlyLimit: 5000,
          color: '#0D9488',
          icon: 'LayoutGrid',
        });
      }
      resolvedCategoryId = catDoc._id;
      resolvedCategoryName = catDoc.name;
    } else {
      resolvedCategoryName = 'Others';
    }

    const expense = await Expense.create({
      userId,
      title,
      amount: parseFloat(amount),
      categoryId: resolvedCategoryId,
      category: resolvedCategoryName,
      paymentMethod: paymentMethod || 'UPI',
      date: expenseDate,
      notes: notes || '',
      location: location || '',
    });

    // Update budget if matching category exists
    const month = `${expenseDate.getFullYear()}-${String(expenseDate.getMonth() + 1).padStart(2, '0')}`;
    if (resolvedCategoryId) {
      await Budget.findOneAndUpdate(
        { userId, categoryId: resolvedCategoryId, month },
        { $inc: { spent: expense.amount }, $setOnInsert: { limit: 5000 } },
        { upsert: true }
      );
    }

    return res.status(201).json(expense);
  } catch (err) {
    console.error('Create expense error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});


// PUT /api/expenses/:id
router.put('/:id', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const updated = await Expense.findOneAndUpdate(
      { _id: req.params.id, userId },
      { $set: req.body },
      { new: true }
    );
    if (!updated) return res.status(404).json({ message: 'Expense not found' });
    return res.json(updated);
  } catch (err) {
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

// DELETE /api/expenses/reset — delete all expenses and reset budgets for user
router.delete('/reset', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    await Expense.deleteMany({ userId });
    await Budget.deleteMany({ userId });
    return res.json({ success: true, message: 'All expenses and budgets have been reset successfully' });
  } catch (err) {
    console.error('Reset expenses error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

// DELETE /api/expenses/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const deleted = await Expense.findOneAndDelete({ _id: req.params.id, userId });
    if (!deleted) return res.status(404).json({ message: 'Expense not found' });
    return res.json({ success: true, message: 'Expense deleted' });
  } catch (err) {
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

module.exports = router;
