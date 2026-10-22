const mongoose = require('mongoose');

const expenseSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true },
    amount: { type: Number, required: true },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
    category: { type: String, default: 'Others' },
    date: { type: Date, default: Date.now },
    paymentMethod: { type: String, default: 'UPI' },
    notes: { type: String, default: '' },
    location: { type: String, default: '' },
    receiptUrl: { type: String, default: '' },
    isRecurring: { type: Boolean, default: false },
    recurringId: { type: mongoose.Schema.Types.ObjectId, ref: 'RecurringExpense' },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Expense || mongoose.model('Expense', expenseSchema);
