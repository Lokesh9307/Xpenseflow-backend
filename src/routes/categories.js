const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Category = require('../models/Category');
const { invalidateUserCategoryCache } = require('../agent/categoryResolver');

// GET /api/categories
router.get('/', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    let categories = await Category.find({ userId });

    // Seed starter categories if none exist (no budgets — those are opt-in)
    if (categories.length === 0) {
      const defaults = [
        { name: 'Food & Dining', color: '#A78BFA', icon: 'fast-food-outline' },
        { name: 'Shopping', color: '#84CC16', icon: 'cart-outline' },
        { name: 'Travel & Commute', color: '#38BDF8', icon: 'car-outline' },
        { name: 'Bills & Utilities', color: '#F59E0B', icon: 'flash-outline' },
        { name: 'Entertainment', color: '#F472B6', icon: 'film-outline' },
        { name: 'Others', color: '#9CA3AF', icon: 'ellipsis-horizontal-outline' },
      ];

      categories = await Category.insertMany(
        defaults.map((d) => ({ ...d, userId, isDefault: true }))
      );
    }

    return res.json(categories);
  } catch (err) {
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

// POST /api/categories
router.post('/', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, limit, warningThreshold, criticalThreshold, color, icon, alertEnabled, alertPercent } = req.body;

    if (!name) {
      return res.status(400).json({ message: 'Category name is required' });
    }

    // Budget limit is optional — only stored when a positive number is given
    const parsedLimit = limit === undefined || limit === null || limit === '' ? NaN : parseFloat(limit);
    const budgetLimit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : null;

    const category = await Category.create({
      userId,
      name,
      limit: budgetLimit,
      monthlyLimit: budgetLimit,
      warningThreshold: warningThreshold || 80,
      criticalThreshold: criticalThreshold || 95,
      alertEnabled: !!alertEnabled,
      alertPercent: Number.isFinite(parseFloat(alertPercent)) ? parseFloat(alertPercent) : 90,
      color: color || '#A78BFA',
      icon: icon || 'fast-food-outline',
    });

    invalidateUserCategoryCache(userId);
    return res.status(201).json(category);
  } catch (err) {
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

// PUT /api/categories/:id
router.put('/:id', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { name, limit, monthlyLimit, warningThreshold, criticalThreshold, color, icon, alertEnabled, alertPercent } = req.body;

    const update = {};
    if (name) update.name = name;
    if (color) update.color = color;
    if (icon) update.icon = icon;
    if (warningThreshold) update.warningThreshold = warningThreshold;
    if (criticalThreshold) update.criticalThreshold = criticalThreshold;

    // Budget limit is OPTIONAL: only touched when the client sent the field.
    // null / '' / 0 clears the budget for this category.
    if (limit !== undefined || monthlyLimit !== undefined) {
      const raw = limit !== undefined ? limit : monthlyLimit;
      const num = raw === null || raw === '' || raw === 0 ? NaN : parseFloat(raw);
      const value = Number.isFinite(num) && num > 0 ? num : null;
      update.limit = value;
      update.monthlyLimit = value;
    }

    // Budget alert (user opt-in, threshold %)
    if (alertEnabled !== undefined) update.alertEnabled = !!alertEnabled;
    if (alertPercent !== undefined) {
      const p = parseFloat(alertPercent);
      if (Number.isFinite(p) && p > 0 && p <= 100) update.alertPercent = p;
    }

    let category = null;
    if (id && id.length === 24) {
      category = await Category.findOneAndUpdate(
        { _id: id, userId },
        { $set: update },
        { new: true }
      );
    }

    if (!category) {
      category = await Category.findOneAndUpdate(
        { name: req.body.previousName || name, userId },
        { $set: update },
        { new: true }
      );
    }

    if (!category) {
      category = await Category.create({
        userId,
        name,
        limit: update.limit ?? null,
        monthlyLimit: update.limit ?? null,
        color: color || '#0D9488',
        icon: icon || 'Food & Dining',
      });
    }

    invalidateUserCategoryCache(userId);
    return res.json(category);
  } catch (err) {
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

// DELETE /api/categories/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    if (id && id.length === 24) {
      await Category.findOneAndDelete({ _id: id, userId });
    } else {
      await Category.findOneAndDelete({ name: id, userId });
    }
    invalidateUserCategoryCache(userId);
    return res.json({ success: true, message: 'Category deleted' });
  } catch (err) {
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

module.exports = router;
