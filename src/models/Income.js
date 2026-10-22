const mongoose = require('mongoose');

const incomeSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    amount: { type: Number, required: true },
    source: { type: String, default: 'Salary' },
    date: { type: Date, default: Date.now },
    note: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Income || mongoose.model('Income', incomeSchema);
