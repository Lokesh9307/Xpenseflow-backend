const mongoose = require('mongoose');

const tiffinEntrySchema = new mongoose.Schema(
  {
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'TiffinGroup', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: Date, default: Date.now },
    mealType: { type: String, default: 'lunch' }, // 'breakfast', 'lunch', 'dinner', 'none'
    count: { type: Number, default: 1 },
    quantity: { type: Number, default: 1 },
    extraPrice: { type: Number, default: 0 },
    totalPrice: { type: Number, default: 80 },
    noTiffin: { type: Boolean, default: false },
    baseQuantity: { type: Number },
    splitMemberIds: [{ type: String }],
    extras: { type: mongoose.Schema.Types.Mixed, default: {} },
    memberBills: { type: mongoose.Schema.Types.Mixed, default: {} },
    participants: [
      {
        memberId: { type: String },
        name: { type: String },
        quantity: { type: Number, default: 1 },
      },
    ],
    notes: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.TiffinEntry || mongoose.model('TiffinEntry', tiffinEntrySchema);
