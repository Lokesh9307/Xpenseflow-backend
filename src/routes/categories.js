const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Category = require('../models/Category');

// GET /api/categories
router.get('/', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    let categories = await Category.find({ userId });

    // Seed default categories if none exist
    if (categories.length === 0) {
      const defaults = [
        { name: 'Food & Dining', limit: 8000, color: '#A78BFA', icon: 'fast-food-outline' },
        { name: 'Shopping', limit: 5000, color: '#84CC16', icon: 'cart-outline' },
        { name: 'Travel & Commute', limit: 4000, color: '#38BDF8', icon: 'car-outline' },
        { name: 'Bills & Utilities', limit: 6000, color: '#F59E0B', icon: 'flash-outline' },
        { name: 'Entertainment', limit: 3000, color: '#F472B6', icon: 'film-outline' },
        { name: 'Others', limit: 3000, color: '#9CA3AF', icon: 'ellipsis-horizontal-outline' },
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
    const { name, limit, warningThreshold, criticalThreshold, color, icon } = req.body;

    if (!name) {
      return res.status(400).json({ message: 'Category name is required' });
    }

    const category = await Category.create({
      userId,
      name,
      limit: limit || 5000,
      warningThreshold: warningThreshold || 80,
      criticalThreshold: criticalThreshold || 95,
      color: color || '#A78BFA',
      icon: icon || 'fast-food-outline',
    });

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
    const { name, limit, monthlyLimit, warningThreshold, criticalThreshold, color, icon } = req.body;

    let category = null;
    if (id && id.length === 24) {
      category = await Category.findOneAndUpdate(
        { _id: id, userId },
        {
          ...(name && { name }),
          ...((limit || monthlyLimit) && { limit: limit || monthlyLimit }),
          ...(warningThreshold && { warningThreshold }),
          ...(criticalThreshold && { criticalThreshold }),
          ...(color && { color }),
          ...(icon && { icon }),
        },
        { new: true }
      );
    }

    if (!category) {
      category = await Category.findOneAndUpdate(
        { name: req.body.previousName || name, userId },
        {
          ...(name && { name }),
          ...((limit || monthlyLimit) && { limit: limit || monthlyLimit }),
          ...(color && { color }),
          ...(icon && { icon }),
        },
        { new: true }
      );
    }

    if (!category) {
      category = await Category.create({
        userId,
        name,
        limit: limit || monthlyLimit || 5000,
        color: color || '#0D9488',
        icon: icon || 'Food & Dining',
      });
    }

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
    return res.json({ success: true, message: 'Category deleted' });
  } catch (err) {
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

module.exports = router;
