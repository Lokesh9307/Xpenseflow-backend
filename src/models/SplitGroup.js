const mongoose = require('mongoose');

const splitGroupSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    photoUrl: { type: String },
    currency: { type: String, default: 'INR' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    defaultSplitType: {
      type: String,
      enum: ['equal', 'percentage', 'shares', 'itemized'],
      default: 'equal',
    },
    members: [
      {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        name: { type: String },
        email: { type: String },
        role: { type: String, enum: ['admin', 'member'], default: 'member' },
        joinedAt: { type: Date, default: Date.now },
        reliabilityScore: { type: Number, default: 100 },
      },
    ],
    // Maintained with the same pairwise math the web app uses
    cachedBalances: { type: mongoose.Schema.Types.Mixed, default: {} },
    archived: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.SplitGroup || mongoose.model('SplitGroup', splitGroupSchema);
