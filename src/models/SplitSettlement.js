const mongoose = require('mongoose');

const splitSettlementSchema = new mongoose.Schema(
  {
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'SplitGroup', required: true },
    expenseId: { type: mongoose.Schema.Types.ObjectId, ref: 'SplitExpense' },
    fromUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    toUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    amount: { type: Number, required: true },
    method: {
      type: String,
      enum: ['upi', 'cash', 'bank_transfer', 'other'],
      default: 'upi',
    },
    status: {
      type: String,
      enum: ['pending', 'completed', 'disputed'],
      default: 'completed',
    },
    isPartial: { type: Boolean, default: false },
    confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    confirmedAt: { type: Date },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.SplitSettlement || mongoose.model('SplitSettlement', splitSettlementSchema);
