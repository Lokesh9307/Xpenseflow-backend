const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true },
    limit: { type: Number, required: true, default: 5000 },
    warningThreshold: { type: Number, default: 80 },
    criticalThreshold: { type: Number, default: 95 },
    color: { type: String, default: '#A78BFA' },
    icon: { type: String, default: 'fast-food-outline' },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Category || mongoose.model('Category', categorySchema);
