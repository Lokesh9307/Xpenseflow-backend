const mongoose = require('mongoose');

const tiffinEntrySchema = new mongoose.Schema(
  {
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'TiffinGroup', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: Date, default: Date.now },
    mealType: { type: String, default: 'Lunch' },
    count: { type: Number, default: 1 },
    extraPrice: { type: Number, default: 0 },
    totalPrice: { type: Number, default: 80 },
    notes: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.TiffinEntry || mongoose.model('TiffinEntry', tiffinEntrySchema);
