const mongoose = require('mongoose');

/**
 * Dual-shape schema: the web app (myExpense) writes `title` + `splits[]`,
 * the mobile app reads/writes the legacy `description` + `splitBetween[]`
 * shape. Both are stored together so each app sees its native format.
 * (Unknown fields coming from the web are preserved on read either way.)
 */
const splitExpenseSchema = new mongoose.Schema(
  {
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'SplitGroup', required: true, index: true },
    amount: { type: Number, required: true },
    paidBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // Web shape
    title: { type: String },
    category: { type: String },
    receiptUrl: { type: String },
    splitType: {
      type: String,
      enum: ['equal', 'percentage', 'shares', 'itemized'],
      default: 'equal',
    },
    splits: [
      {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        shareAmount: { type: Number },
        status: {
          type: String,
          enum: ['unpaid', 'pending_confirmation', 'paid'],
          default: 'unpaid',
        },
        transactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Expense' },
      },
    ],
    isLocked: { type: Boolean, default: false },
    disputeWindowEndsAt: { type: Date },
    // Legacy / mobile shape
    description: { type: String },
    splitBetween: [
      {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        amount: { type: Number },
        status: { type: String, default: 'unpaid' },
        transactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Expense' },
      },
    ],
    date: { type: Date, default: Date.now },
    isSettled: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.SplitExpense || mongoose.model('SplitExpense', splitExpenseSchema);
