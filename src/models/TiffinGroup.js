const mongoose = require('mongoose');

const tiffinGroupSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    defaultPrice: { type: Number, default: 80 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
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
