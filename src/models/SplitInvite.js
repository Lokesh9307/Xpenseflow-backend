const mongoose = require('mongoose');

const splitInviteSchema = new mongoose.Schema(
  {
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'SplitGroup', required: true },
    code: { type: String, required: true }, // 4-digit PIN
    token: { type: String, required: true, unique: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    maxUses: { type: Number, default: null },
    useCount: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
    revoked: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.SplitInvite || mongoose.model('SplitInvite', splitInviteSchema);
