const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDeterministicIntent } = require('../agent/deterministicIntent');

test('parses "add todays tiffin on group camp bois between all members" with group and splitBetweenAll', () => {
  const query = 'add todays tiffin on group camp bois between all members';
  const intent = parseDeterministicIntent(query);

  assert.equal(intent.toolName, 'log_tiffin');
  assert.equal(intent.params.mealType, 'lunch');
  assert.equal(intent.params.date, 'today');
  assert.equal(intent.params.count, 1);
  assert.equal(intent.params.groupName, 'camp bois');
  assert.equal(intent.params.splitBetweenAll, true);
});

test('parses "log dinner for group Office Buddies between all members"', () => {
  const query = 'log dinner for group Office Buddies between all members';
  const intent = parseDeterministicIntent(query);

  assert.equal(intent.toolName, 'log_tiffin');
  assert.equal(intent.params.mealType, 'dinner');
  assert.equal(intent.params.groupName, 'Office Buddies');
  assert.equal(intent.params.splitBetweenAll, true);
});

