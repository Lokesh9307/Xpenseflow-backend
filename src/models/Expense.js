const mongoose = require('mongoose');

const expenseSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true },
    amount: { type: Number, required: true },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', index: true },
    category: { type: String }, // No default 'Others' to allow accurate populated lookup from categoryId
    date: { type: Date, default: Date.now },
    paymentMethod: { type: String, default: 'UPI' },
    notes: { type: String, default: '' },
    location: { type: String, default: '' },
    receiptUrl: { type: String, default: '' },
    attachment: { type: String, default: '' },
    isRecurring: { type: Boolean, default: false },
    recurringExpenseId: { type: mongoose.Schema.Types.ObjectId, ref: 'RecurringExpense' },
    recurringId: { type: mongoose.Schema.Types.ObjectId, ref: 'RecurringExpense' },
    sourceType: { type: String, enum: ['manual', 'split'], default: 'manual' },
    splitGroupId: { type: mongoose.Schema.Types.ObjectId, ref: 'SplitGroup' },
    splitExpenseId: { type: mongoose.Schema.Types.ObjectId, ref: 'SplitExpense' },
    syncSource: { type: String },
    syncRefId: { type: String, index: true },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Expense || mongoose.model('Expense', expenseSchema);

