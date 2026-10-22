const mongoose = require('mongoose');

const recurringExpenseSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true },
    amount: { type: Number, required: true },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
    frequency: {
      type: String,
      enum: ['daily', 'weekly', 'monthly', 'yearly'],
      default: 'monthly',
    },
    startDate: { type: Date, default: Date.now },
    nextDueDate: { type: Date },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.RecurringExpense ||
  mongoose.model('RecurringExpense', recurringExpenseSchema);
