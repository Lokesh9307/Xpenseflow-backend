const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { mergePendingAction } = require('../agent/conversationContext');
const { validateRegisteredToolCall } = require('../agent/toolRegistry');

const pending = {
  toolName: 'create_expense',
  params: {
    amount: 400,
    category: 'Others',
    title: 'Petrol',
    paymentMethod: 'UPI',
    date: 'today',
    categoryId: 'client-only-id',
    saved: false,
    isComplete: true,
  },
};

describe('Copilot clarification follow-ups', () => {
  it('fills a category answer and strips display-only fields', () => {
    const merged = mergePendingAction(pending, 'Travel & Commute');
    assert.equal(merged.field, 'category');
    assert.equal(merged.action.params.category, 'Travel & Commute');
    assert.equal(merged.action.params.categoryId, undefined);
    assert.equal(merged.action.params.saved, undefined);
    assert.equal(validateRegisteredToolCall(merged.action.toolName, merged.action.params), true);
  });

  it('fills an amount answer', () => {
    const merged = mergePendingAction(pending, '₹250');
    assert.equal(merged.field, 'amount');
    assert.equal(merged.action.params.amount, 250);
    assert.equal(validateRegisteredToolCall(merged.action.toolName, merged.action.params), true);
  });

  it('fills a payment method answer', () => {
    const merged = mergePendingAction(pending, 'by cash');
    assert.equal(merged.field, 'paymentMethod');
    assert.equal(merged.action.params.paymentMethod, 'Cash');
  });

  it('fills a date answer', () => {
    const merged = mergePendingAction(pending, 'yesterday');
    assert.equal(merged.field, 'date');
    assert.equal(merged.action.params.date, 'yesterday');
  });

  it('does not treat a new command as a clarification answer', () => {
    assert.equal(mergePendingAction(pending, 'Open analytics'), null);
    assert.equal(mergePendingAction(pending, 'How much did I spend this month?'), null);
    assert.equal(mergePendingAction(pending, 'Spent 200 on dinner'), null);
  });

  it('ignores unsupported pending tools', () => {
    assert.equal(
      mergePendingAction({ toolName: 'delete_expense', params: {} }, 'Food'),
      null
    );
  });
});
