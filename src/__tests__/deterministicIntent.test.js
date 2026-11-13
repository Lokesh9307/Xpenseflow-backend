const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseDeterministicFallback } = require('../agent/intentResolver');

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

describe('Deterministic Copilot intent coverage', () => {
  it('creates an expense with category, date and title', () => {
    const result = parseDeterministicFallback('I bought groceries for ₹850 yesterday');
    assert.equal(result.toolName, 'create_expense');
    assert.equal(result.params.amount, 850);
    assert.equal(result.params.category, 'Groceries');
    assert.equal(result.params.date, 'yesterday');
    assert.equal(result.params.isExplicitDate, true);
    assert.equal(result.params.title, 'Groceries');
  });

  it('extracts the spent amount rather than an item count', () => {
    const result = parseDeterministicFallback('Add 2 coffees for 150');
    assert.equal(result.toolName, 'create_expense');
    assert.equal(result.params.amount, 150);
    assert.equal(result.params.category, 'Food & Dining');
  });

  it('does not treat a year as an expense amount', () => {
    const result = parseDeterministicFallback('Show me 2025 expenses');
    assert.equal(result.toolName, 'query_expenses');
    assert.equal(new Date(result.params.startDate).getFullYear(), 2025);
    assert.equal(new Date(result.params.endDate).getFullYear(), 2025);
  });

  it('asks for an amount instead of guessing', () => {
    const result = parseDeterministicFallback('Spent on petrol');
    assert.equal(result.toolName, 'request_clarification');
    assert.equal(result.params.missingField, 'amount');
  });

  it('asks for clarification with two different amounts', () => {
    const result = parseDeterministicFallback('Spent 400 and 250 on food');
    assert.equal(result.toolName, 'request_clarification');
    assert.equal(result.params.missingField, 'amount');
  });

  it('answers this-month spending without creating an expense', () => {
    const result = parseDeterministicFallback('How much did I spend this month?');
    assert.equal(result.toolName, 'query_expenses');
    assert.equal(result.params.month, monthKey(new Date()));
  });

  it('filters spending by category and last month', () => {
    const result = parseDeterministicFallback('Show my food expenses last month');
    const previous = new Date();
    previous.setMonth(previous.getMonth() - 1);
    assert.equal(result.toolName, 'query_expenses');
    assert.equal(result.params.category, 'Food & Dining');
    assert.equal(result.params.month, monthKey(previous));
  });

  it('supports largest expense and top category focus', () => {
    const largest = parseDeterministicFallback('What is my biggest expense this month?');
    assert.equal(largest.params.focus, 'largest_expense');

    const top = parseDeterministicFallback('Where did most of my money go?');
    assert.equal(top.params.focus, 'top_category');
  });

  it('compares this month with last month in one grounded query', () => {
    const result = parseDeterministicFallback('Compare my spending this month with last month');
    assert.equal(result.toolName, 'query_expenses');
    assert.equal(result.params.comparePreviousMonth, true);
    assert.equal(result.params.month, monthKey(new Date()));
  });

  it('uses a day range for today and explicit dates', () => {
    const today = parseDeterministicFallback('How much did I spend today?');
    assert.equal(today.toolName, 'query_expenses');
    assert.ok(today.params.startDate);
    assert.ok(today.params.endDate);

    const explicit = parseDeterministicFallback('What did I spend on petrol on 12/10?');
    assert.equal(explicit.params.category, 'Travel & Commute');
    assert.ok(explicit.params.startDate.startsWith(String(new Date().getFullYear())));
  });

  it('supports recent transaction lists without a date filter', () => {
    const result = parseDeterministicFallback('Show my recent transactions');
    assert.equal(result.toolName, 'query_expenses');
    assert.equal(result.params.limit, 5);
    assert.equal(result.params.month, undefined);
  });

  it('checks budget and split balances', () => {
    assert.equal(
      parseDeterministicFallback('How much budget is left?').toolName,
      'query_budget'
    );
    assert.equal(
      parseDeterministicFallback('What is my balance?').toolName,
      'query_budget'
    );
    assert.equal(
      parseDeterministicFallback('Check my split expense balances').toolName,
      'query_splits'
    );
  });

  it('logs tiffin with meal and date', () => {
    const result = parseDeterministicFallback('Log dinner tiffin yesterday');
    assert.equal(result.toolName, 'log_tiffin');
    assert.equal(result.params.mealType, 'dinner');
    assert.equal(result.params.date, 'yesterday');
  });

  it('updates and deletes the last expense only when explicitly asked', () => {
    const update = parseDeterministicFallback('Change last expense to 600');
    assert.equal(update.toolName, 'update_expense');
    assert.equal(update.params.targetQuery, 'last expense');
    assert.equal(update.params.updates.amount, 600);

    const remove = parseDeterministicFallback('Delete last expense');
    assert.equal(remove.toolName, 'delete_expense');
    assert.equal(remove.params.targetQuery, 'last expense');
  });

  it('navigates only for explicit screen requests', () => {
    const nav = parseDeterministicFallback('Take me to tiffin history');
    assert.equal(nav.toolName, 'navigate_app');
    assert.equal(nav.params.screenTarget, 'TiffinTransactions');

    const query = parseDeterministicFallback('Show my coffee expenses');
    assert.equal(query.toolName, 'query_expenses');
  });

  it('handles natural phrasing for insights, cards, tea, and budgets', () => {
    const top = parseDeterministicFallback("What's eating most of my budget?");
    assert.equal(top.toolName, 'query_expenses');
    assert.equal(top.params.focus, 'top_category');

    const compare = parseDeterministicFallback('Did I spend more this month than last?');
    assert.equal(compare.params.comparePreviousMonth, true);

    const latest = parseDeterministicFallback('Show me my latest expenses');
    assert.equal(latest.toolName, 'query_expenses');

    const petrol = parseDeterministicFallback('Put 350 petrol on my card');
    assert.equal(petrol.toolName, 'create_expense');
    assert.equal(petrol.params.amount, 350);
    assert.equal(petrol.params.category, 'Travel & Commute');
    assert.equal(petrol.params.paymentMethod, 'Credit Card');

    const tea = parseDeterministicFallback('I need to log 80 rupees for tea');
    assert.equal(tea.params.category, 'Food & Dining');

    const budgets = parseDeterministicFallback('Open the budgets page');
    assert.equal(budgets.toolName, 'navigate_app');
    assert.equal(budgets.params.screenTarget, 'ExpenseTrackerSettings');
  });

  it('returns a grounded help answer for unrelated chat', () => {
    const result = parseDeterministicFallback('Hello there');
    assert.equal(result.toolName, 'general_answer');
    assert.match(result.params.response, /log expenses/i);
  });
});
