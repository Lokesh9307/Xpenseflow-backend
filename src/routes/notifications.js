const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Notification = require('../models/Notification');

// GET /api/notifications
router.get('/', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    let notifs = await Notification.find({ userId }).sort({ createdAt: -1 }).limit(30);

    if (notifs.length === 0) {
      // Seed welcome notification
      notifs = await Notification.insertMany([
        {
          userId,
          title: 'Welcome to XpenseFlow!',
          message: 'Your personal finance and smart expense tracker is ready to use.',
          type: 'info',
          isRead: false,
        },
      ]);
    }

    return res.json(notifs);
  } catch (err) {
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

// PUT /api/notifications (mark read)
router.put('/', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    await Notification.updateMany({ userId }, { $set: { isRead: true } });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

module.exports = router;
