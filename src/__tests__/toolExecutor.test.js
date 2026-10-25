const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { executeTool } = require('../agent/toolExecutor');
const { clearIdempotencyCache } = require('../agent/idempotency');

describe('Tool Executor Security & Validation Tests', () => {
  beforeEach(() => {
    clearIdempotencyCache();
  });

  it('rejects unauthenticated execution attempts when userId is missing', async () => {
    const res = await executeTool('create_expense', { amount: 100 }, { userId: null });
    assert.equal(res.success, false);
    assert.ok(res.error.includes('Unauthenticated'));
  });

  it('returns clarification request when expense amount is invalid or zero', async () => {
    const res = await executeTool('create_expense', { amount: -50 }, { userId: 'user_123' });
    assert.equal(res.success, false);
    assert.equal(res.intent, 'clarification.required');
    assert.equal(res.clarification.missingField, 'amount');
  });

  it('returns clarification request when expense amount is not a number', async () => {
    const res = await executeTool('create_expense', { amount: NaN }, { userId: 'user_123' });
    assert.equal(res.success, false);
    assert.equal(res.intent, 'clarification.required');
    assert.equal(res.clarification.missingField, 'amount');
  });

  it('executes navigate_app successfully for registered screen', async () => {
    const res = await executeTool('navigate_app', { screenTarget: 'Expenses' }, { userId: 'user_123' });
    assert.equal(res.success, true);
    assert.equal(res.intent, 'navigation.open');
    assert.ok(res.navigationAction);
    assert.equal(res.navigationAction.screenId, 'Expenses');
    assert.equal(res.navigationAction.title, 'All Expenses');
  });

  it('rejects navigate_app for invalid or arbitrary screen name', async () => {
    const res = await executeTool('navigate_app', { screenTarget: 'MaliciousAdminRoute' }, { userId: 'user_123' });
    assert.equal(res.success, false);
    assert.equal(res.intent, 'navigation.help');
    assert.equal(res.navigationAction, null);
  });

  it('executes request_clarification correctly', async () => {
    const res = await executeTool(
      'request_clarification',
      { question: 'Which payment method did you use?', options: ['UPI', 'Cash', 'Credit Card'], missingField: 'paymentMethod' },
      { userId: 'user_123' }
    );
    assert.equal(res.success, true);
    assert.equal(res.intent, 'clarification.required');
    assert.equal(res.clarification.question, 'Which payment method did you use?');
    assert.equal(res.clarification.options.length, 3);
  });

  it('executes general_answer correctly', async () => {
    const res = await executeTool('general_answer', { response: 'XpenseFlow helps you track spending.' }, { userId: 'user_123' });
    assert.equal(res.success, true);
    assert.equal(res.intent, 'general.answer');
    assert.equal(res.message, 'XpenseFlow helps you track spending.');
  });
});
