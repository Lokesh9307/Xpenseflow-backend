const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isValidScreen, resolveNavigation } = require('../agent/navigationRegistry');

describe('Navigation Registry Tests', () => {
  it('validates registered screens correctly', () => {
    assert.equal(isValidScreen('Expenses'), true);
    assert.equal(isValidScreen('Analytics'), true);
    assert.equal(isValidScreen('TiffinTransactions'), true);
    assert.equal(isValidScreen('SplitTransactions'), true);
    assert.equal(isValidScreen('Profile'), true);
    assert.equal(isValidScreen('Recurring'), true);
    assert.equal(isValidScreen('ExpenseTrackerSettings'), true);
  });

  it('rejects arbitrary, malicious, or unregistered routes', () => {
    assert.equal(isValidScreen('SecretAdminScreen'), false);
    assert.equal(isValidScreen('https://phishing.site'), false);
    assert.equal(isValidScreen('../hack/route'), false);
    assert.equal(isValidScreen(''), false);
    assert.equal(isValidScreen(null), false);
  });

  it('resolves natural language navigation requests', () => {
    const resReports = resolveNavigation('Show monthly reports');
    assert.ok(resReports);
    assert.equal(resReports.screenId, 'Analytics');

    const resTiffin = resolveNavigation('Take me to tiffin history');
    assert.ok(resTiffin);
    assert.equal(resTiffin.screenId, 'TiffinTransactions');

    const resSplits = resolveNavigation('Open split expenses');
    assert.ok(resSplits);
    assert.equal(resSplits.screenId, 'SplitTransactions');

    const resExpenses = resolveNavigation('Open expenses');
    assert.ok(resExpenses);
    assert.equal(resExpenses.screenId, 'Expenses');
  });

  it('resolves sign out queries safely to Profile screen without auto-signout', () => {
    const resLogout = resolveNavigation('Where can I sign out?');
    assert.ok(resLogout);
    assert.equal(resLogout.screenId, 'Profile');
    assert.ok(resLogout.description.includes('Sign out can be accessed safely here'));
  });

  it('returns null for unresolvable navigation requests', () => {
    const resInvalid = resolveNavigation('Fly me to the moon');
    assert.equal(resInvalid, null);
  });
});
