const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseDeterministicFallback, validateToolCall } = require('../agent/intentResolver');

describe('Intent Resolver & Schema Validation Tests', () => {
  it('extracts expense.create with explicit amount and inferred date', () => {
    const res = parseDeterministicFallback('Spent ₹400 on petrol');
    assert.equal(res.toolName, 'create_expense');
    assert.equal(res.params.amount, 400);
    assert.equal(res.params.category, 'Travel & Commute');
    assert.equal(res.params.paymentMethod, 'UPI');
    assert.equal(res.params.isExplicitDate, false);
    assert.equal(res.params.date, 'today');
  });

  it('tracks explicit date when user says yesterday', () => {
    const res = parseDeterministicFallback('Paid 250 rs for coffee yesterday via cash');
    assert.equal(res.toolName, 'create_expense');
    assert.equal(res.params.amount, 250);
    assert.equal(res.params.category, 'Food & Dining');
    assert.equal(res.params.paymentMethod, 'Cash');
    assert.equal(res.params.isExplicitDate, true);
    assert.equal(res.params.date, 'yesterday');
  });

  it('asks for clarification when amount is missing from expense statement', () => {
    const res = parseDeterministicFallback('I bought some groceries');
    assert.equal(res.toolName, 'request_clarification');
    assert.equal(res.params.missingField, 'amount');
    assert.ok(res.params.options.length > 0);
  });

  it('resolves tiffin logging requests', () => {
    const resLunch = parseDeterministicFallback('Log lunch tiffin for today');
    assert.equal(resLunch.toolName, 'log_tiffin');
    assert.equal(resLunch.params.mealType, 'lunch');

    const resDinner = parseDeterministicFallback('Log dinner tiffin');
    assert.equal(resDinner.toolName, 'log_tiffin');
    assert.equal(resDinner.params.mealType, 'dinner');
  });

  it('resolves tiffin summary query requests', () => {
    const res = parseDeterministicFallback('How many tiffins did I have this month?');
    assert.equal(res.toolName, 'query_tiffin');
  });

  it('resolves budget query requests', () => {
    const res = parseDeterministicFallback('How much budget is left?');
    assert.equal(res.toolName, 'query_budget');
  });

  it('resolves split query requests', () => {
    const res = parseDeterministicFallback('Who owes me money in split bills?');
    assert.equal(res.toolName, 'query_splits');
  });

  it('resolves undo last expense requests', () => {
    const res = parseDeterministicFallback('Undo last transaction');
    assert.equal(res.toolName, 'undo_last_expense');
  });

  it('resolves navigation requests', () => {
    const res = parseDeterministicFallback('Take me to tiffin history');
    assert.equal(res.toolName, 'navigate_app');
    assert.equal(res.params.screenTarget, 'TiffinTransactions');
  });

  it('validates tool call schemas correctly', () => {
    assert.equal(validateToolCall('create_expense', { amount: 500 }), true);
    assert.equal(validateToolCall('create_expense', { amount: -50 }), false);
    assert.equal(validateToolCall('create_expense', {}), false);

    assert.equal(validateToolCall('navigate_app', { screenTarget: 'Expenses' }), true);
    assert.equal(validateToolCall('navigate_app', { screenTarget: '' }), false);

    assert.equal(validateToolCall('log_tiffin', { mealType: 'lunch' }), true);
    assert.equal(validateToolCall('log_tiffin', {}), false);

    assert.equal(validateToolCall('request_clarification', { question: 'Select?', options: ['A', 'B'] }), true);
    assert.equal(validateToolCall('request_clarification', { question: 'Select?' }), false);
  });
});
