const mongoose = require('mongoose');

const splitGroupSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    currency: { type: String, default: 'INR' },
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

module.exports = mongoose.models.SplitGroup || mongoose.model('SplitGroup', splitGroupSchema);
