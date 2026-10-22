const mongoose = require('mongoose');

const tiffinGroupSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    defaultPrice: { type: Number, default: 80 },
    pricePerTiffin: { type: Number, default: 80 },
    inviteCode: { type: String, default: () => Math.floor(1000 + Math.random() * 9000).toString() },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    archived: { type: Boolean, default: false },
    members: [
      {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        name: { type: String },
        email: { type: String },
      },
    ],
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.TiffinGroup || mongoose.model('TiffinGroup', tiffinGroupSchema);
