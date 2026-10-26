const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true },
    // Budget is OPTIONAL — a category only has a budget when the user enters
    // one. No silent 5000 defaults.
    monthlyLimit: { type: Number, default: null },
    limit: { type: Number, default: null },
    warningThreshold: { type: Number, default: 80 },
    criticalThreshold: { type: Number, default: 95 },
    // User opt-in: alert when this category's budget usage reaches alertPercent
    alertEnabled: { type: Boolean, default: false },
    alertPercent: { type: Number, default: 90 },
    color: { type: String, default: '#A78BFA' },
    icon: { type: String, default: 'fast-food-outline' },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Category || mongoose.model('Category', categorySchema);
