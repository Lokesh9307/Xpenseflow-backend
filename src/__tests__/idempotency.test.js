const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  checkIdempotency,
  lockRequestId,
  saveIdempotencyResult,
  markIdempotencyFailed,
  clearIdempotencyCache,
} = require('../agent/idempotency');

describe('Idempotency Manager Tests', () => {
  beforeEach(() => {
    clearIdempotencyCache();
  });

  it('returns exists: false for unseen request ID', () => {
    const res = checkIdempotency('req_unseen_123');
    assert.equal(res.exists, false);
  });

  it('locks request in progress', () => {
    lockRequestId('req_test_1');
    const res = checkIdempotency('req_test_1');
    assert.equal(res.exists, true);
    assert.equal(res.status, 'IN_PROGRESS');
  });

  it('stores and returns completed mutation result on duplicate call', () => {
    const reqId = 'req_duplicate_test';
    lockRequestId(reqId);
    saveIdempotencyResult(reqId, {
      success: true,
      data: { id: 'exp_123', amount: 400, category: 'Travel & Commute' },
    });

    const duplicateCheck = checkIdempotency(reqId);
    assert.equal(duplicateCheck.exists, true);
    assert.equal(duplicateCheck.status, 'COMPLETED');
    assert.equal(duplicateCheck.result.data.amount, 400);
    assert.equal(duplicateCheck.result.data.category, 'Travel & Commute');
  });

  it('marks failed requests properly so retry can be detected', () => {
    const reqId = 'req_failed_test';
    lockRequestId(reqId);
    markIdempotencyFailed(reqId, 'Database connection dropped');

    const res = checkIdempotency(reqId);
    assert.equal(res.exists, true);
    assert.equal(res.status, 'FAILED');
    assert.ok(res.result.error.includes('Database connection dropped'));
  });
});
