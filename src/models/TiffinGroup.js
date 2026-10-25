const mongoose = require('mongoose');

const tiffinGroupSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    pricePerTiffin: { type: Number, default: 100 },
    defaultPrice: { type: Number },
    inviteCode: { type: String, default: () => Math.floor(1000 + Math.random() * 9000).toString() },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    archived: { type: Boolean, default: false },
    currentCycleStartedAt: { type: Date, default: Date.now },
    timezone: { type: String, default: 'Asia/Kolkata' },
    members: [
      {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        name: { type: String },
        email: { type: String },
        memberType: { type: String, enum: ['placeholder', 'joined'], default: 'placeholder' },
        joinedAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.TiffinGroup || mongoose.model('TiffinGroup', tiffinGroupSchema);

