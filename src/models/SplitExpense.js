const mongoose = require('mongoose');

const splitExpenseSchema = new mongoose.Schema(
  {
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'SplitGroup', required: true, index: true },
    description: { type: String, required: true },
    amount: { type: Number, required: true },
    paidBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    splitBetween: [
      {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        amount: { type: Number, required: true },
      },
    ],
    date: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.SplitExpense || mongoose.model('SplitExpense', splitExpenseSchema);
