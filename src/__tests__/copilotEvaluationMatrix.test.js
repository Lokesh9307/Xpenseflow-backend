/**
 * Comprehensive AI Copilot Evaluation Matrix
 * 
 * 210 diverse test cases spanning:
 * - Basic expense logging & entity extraction
 * - Natural language & colloquial speech ("bucks", "chai", "petrol")
 * - Spending queries, month-over-month comparisons & analytics
 * - Tiffin meals & plate calculations
 * - Split bills & balance queries
 * - Application navigation
 * - Ambiguous inputs requiring clarification
 * - Adversarial prompts, negations, and safety constraints
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseDeterministicFallback } = require('../agent/intentResolver');

describe('Copilot 210-Case Evaluation Matrix', () => {

  // ── 1. Basic Expense Creation (50 Cases) ──────────────────────────────────
  describe('Group 1: Basic Expense Creation & Entity Extraction', () => {
    const cases = [
      { text: 'Spent 250 on lunch', amount: 250, cat: 'Food & Dining' },
      { text: 'Paid ₹400 for petrol', amount: 400, cat: 'Travel & Commute' },
      { text: 'Bought groceries for 850 rupees', amount: 850, cat: 'Groceries' },
      { text: 'Spent 1200 on new shoes', amount: 1200, cat: 'Shopping' },
      { text: 'Paid electricity bill of 1500', amount: 1500, cat: 'Bills & Utilities' },
      { text: 'Movie ticket for 350', amount: 350, cat: 'Entertainment' },
      { text: 'Gym membership 2000', amount: 2000, cat: 'Health & Medical' },
      { text: 'Bought coffee for 180', amount: 180, cat: 'Food & Dining' },
      { text: 'Paid 300 for auto fare', amount: 300, cat: 'Travel & Commute' },
      { text: 'Dinner with friends 1400', amount: 1400, cat: 'Food & Dining' },
      { text: 'Bought milk and bread 95', amount: 95, cat: 'Groceries' },
      { text: 'Wifi recharge 899', amount: 899, cat: 'Bills & Utilities' },
      { text: 'Uber ride 240', amount: 240, cat: 'Travel & Commute' },
      { text: 'Ola cab 320', amount: 320, cat: 'Travel & Commute' },
      { text: 'Zomato order 450', amount: 450, cat: 'Food & Dining' },
      { text: 'Swiggy dinner 520', amount: 520, cat: 'Food & Dining' },
      { text: 'Starbucks latte 380', amount: 380, cat: 'Food & Dining' },
      { text: 'Zara shirt 1990', amount: 1990, cat: 'Shopping' },
      { text: 'Amazon order 650', amount: 650, cat: 'Shopping' },
      { text: 'Flipkart purchase 1100', amount: 1100, cat: 'Shopping' },
      { text: 'Diesel for car 2500', amount: 2500, cat: 'Travel & Commute' },
      { text: 'Blinkit order 340', amount: 340, cat: 'Groceries' },
      { text: 'Zepto instant groceries 210', amount: 210, cat: 'Groceries' },
      { text: 'Medicine from Apollo 420', amount: 420, cat: 'Health & Medical' },
      { text: 'Doctor consultation fee 500', amount: 500, cat: 'Health & Medical' },
      { text: 'Dentist cleaning 1200', amount: 1200, cat: 'Health & Medical' },
      { text: 'PVR cinema tickets 600', amount: 600, cat: 'Entertainment' },
      { text: 'Netflix monthly 649', amount: 649, cat: 'Entertainment' },
      { text: 'Spotify subscription 119', amount: 119, cat: 'Entertainment' },
      { text: 'Mobile recharge 299', amount: 299, cat: 'Bills & Utilities' },
      { text: 'Water bill 180', amount: 180, cat: 'Bills & Utilities' },
      { text: 'Gas cylinder booking 950', amount: 950, cat: 'Bills & Utilities' },
      { text: 'House maintenance 1500', amount: 1500, cat: 'Bills & Utilities' },
      { text: 'Breakfast at cafe 160', amount: 160, cat: 'Food & Dining' },
      { text: 'Snacks at office 80', amount: 80, cat: 'Food & Dining' },
      { text: 'Pizza party 899', amount: 899, cat: 'Food & Dining' },
      { text: 'Burger king 280', amount: 280, cat: 'Food & Dining' },
      { text: 'Tea and biscuits 40', amount: 40, cat: 'Food & Dining' },
      { text: 'Chai at tapri 20', amount: 20, cat: 'Food & Dining' },
      { text: 'Toll plaza tax 110', amount: 110, cat: 'Travel & Commute' },
      { text: 'Metro card recharge 500', amount: 500, cat: 'Travel & Commute' },
      { text: 'Train ticket 450', amount: 450, cat: 'Travel & Commute' },
      { text: 'Flight ticket 4800', amount: 4800, cat: 'Travel & Commute' },
      { text: 'Supermarket shopping 1750', amount: 1750, cat: 'Groceries' },
      { text: 'Vegetables from vendor 140', amount: 140, cat: 'Groceries' },
      { text: 'Pharmacy vitamins 650', amount: 650, cat: 'Health & Medical' },
      { text: 'Concert ticket 1500', amount: 1500, cat: 'Entertainment' },
      { text: 'Gaming steam pass 799', amount: 799, cat: 'Entertainment' },
      { text: 'Office stationery 220', amount: 220, cat: 'Shopping' },
      { text: 'H&M jeans 2499', amount: 2499, cat: 'Shopping' },
    ];

    cases.forEach((c, idx) => {
      it(`Case 1.${idx + 1}: "${c.text}" -> ${c.amount} in ${c.cat}`, () => {
        const res = parseDeterministicFallback(c.text);
        assert.equal(res.toolName, 'create_expense');
        assert.equal(res.params.amount, c.amount);
        assert.equal(res.params.category, c.cat);
      });
    });
  });

  // ── 2. Natural Human Speech & Colloquial Phrasing (30 Cases) ─────────────
  describe('Group 2: Natural Colloquial & Mixed-Language Phrasing', () => {
    const cases = [
      { text: 'Grabbed some food for 180 bucks', amount: 180, cat: 'Food & Dining' },
      { text: 'Put 500 on petrol', amount: 500, cat: 'Travel & Commute' },
      { text: 'Swiped card for groceries 1200', amount: 1200, cat: 'Groceries' },
      { text: 'Filled tank with diesel for 2000', amount: 2000, cat: 'Travel & Commute' },
      { text: 'Had lunch today for 220', amount: 220, cat: 'Food & Dining' },
      { text: 'Chai sutta break 50', amount: 50, cat: 'Food & Dining' },
      { text: 'Paid my rent 12000 yesterday', amount: 12000, cat: 'Bills & Utilities' },
      { text: 'Bought some sabzi for 85', amount: 85, cat: 'Groceries' },
      { text: 'Blinkit order worth 430', amount: 430, cat: 'Groceries' },
      { text: 'Dine out bill was 1650', amount: 1650, cat: 'Food & Dining' },
      { text: 'Fuel cost me 800', amount: 800, cat: 'Travel & Commute' },
      { text: 'Rapido ride 65', amount: 65, cat: 'Travel & Commute' },
      { text: 'Took an auto for 90 rupees', amount: 90, cat: 'Travel & Commute' },
      { text: 'Bought eggs and bread for 110', amount: 110, cat: 'Groceries' },
      { text: 'Order from Instamart 380', amount: 380, cat: 'Groceries' },
      { text: 'Swiggy instamart 290', amount: 290, cat: 'Groceries' },
      { text: 'Paid electricity bill 1450 via UPI', amount: 1450, cat: 'Bills & Utilities' },
      { text: 'Bought zara clothes for 3500', amount: 3500, cat: 'Shopping' },
      { text: 'Myntra dress 1899', amount: 1899, cat: 'Shopping' },
      { text: 'Paid hospital bill of 3200', amount: 3200, cat: 'Health & Medical' },
      { text: 'Bought meds for 250', amount: 250, cat: 'Health & Medical' },
      { text: 'Movie with popcorn 750', amount: 750, cat: 'Entertainment' },
      { text: 'Hotstar subscription 499', amount: 499, cat: 'Entertainment' },
      { text: 'Broadband payment 799', amount: 799, cat: 'Bills & Utilities' },
      { text: 'Snacks at airport 350', amount: 350, cat: 'Food & Dining' },
      { text: 'Airport taxi 850', amount: 850, cat: 'Travel & Commute' },
      { text: 'Had dinner at dhaba 340', amount: 340, cat: 'Food & Dining' },
      { text: 'Bought sweets 260', amount: 260, cat: 'Food & Dining' },
      { text: 'Shopped on amazon for 1420', amount: 1420, cat: 'Shopping' },
      { text: 'Car wash 300', amount: 300, cat: 'Travel & Commute' },
    ];

    cases.forEach((c, idx) => {
      it(`Case 2.${idx + 1}: "${c.text}"`, () => {
        const res = parseDeterministicFallback(c.text);
        assert.equal(res.toolName, 'create_expense');
        assert.equal(res.params.amount, c.amount);
        assert.equal(res.params.category, c.cat);
      });
    });
  });

  // ── 3. Spending Queries, Summaries & Comparisons (40 Cases) ──────────────
  describe('Group 3: Financial Analytics & Grounded Queries', () => {
    const queries = [
      'How much did I spend this month?',
      'How much did I spend last month?',
      'What did I spend today?',
      'How much did I spend yesterday?',
      'Show my expenses this week',
      'Show my expenses last week',
      'What is my total spending?',
      'How much did I spend on food this month?',
      'Show my travel expenses last month',
      'Where did most of my money go?',
      'What is eating my budget?',
      'Show top category this month',
      'What is my biggest expense this month?',
      'What is my highest expense?',
      'Compare my spending this month with last month',
      'Compare this month vs last month',
      'Show recent transactions',
      'Show my latest 5 expenses',
      'What did I spend on petrol?',
      'Show my grocery expenses',
      'How much did I spend on shopping this month?',
      'How much went into bills this month?',
      'Show entertainment expenses',
      'What did I spend on health last month?',
      'How much budget is left?',
      'What is my remaining budget?',
      'Check my budget status',
      'How much money do I have left?',
      'Show my spending breakdown',
      'Show summary of expenses',
      'What did I spend on coffee?',
      'Total spent on uber this month',
      'Total spent on swiggy',
      'Show my expenses for the last 7 days',
      'What did I spend 3 days ago?',
      'Show my last transaction',
      'List all my expenses',
      'How much did I spend on dinner this month?',
      'Compare groceries spending with last month',
      'Show my food summary',
    ];

    queries.forEach((q, idx) => {
      it(`Case 3.${idx + 1}: Query "${q}"`, () => {
        const res = parseDeterministicFallback(q);
        assert.ok(
          res.toolName === 'query_expenses' || res.toolName === 'query_budget',
          `Expected query tool but got ${res.toolName}`
        );
      });
    });
  });

  // ── 4. Tiffin Tracker Queries & Logging (25 Cases) ────────────────────────
  describe('Group 4: Tiffin Tracker Workflows', () => {
    const tiffinCases = [
      { text: 'Mark lunch tiffin for today', tool: 'log_tiffin' },
      { text: 'Log today lunch tiffin', tool: 'log_tiffin' },
      { text: 'Mark dinner tiffin', tool: 'log_tiffin' },
      { text: 'Log 2 tiffins for lunch', tool: 'log_tiffin' },
      { text: 'Had tiffin today', tool: 'log_tiffin' },
      { text: 'Mark tiffin eaten', tool: 'log_tiffin' },
      { text: 'Log yesterday lunch tiffin', tool: 'log_tiffin' },
      { text: 'Mark lunch tiffin for yesterday', tool: 'log_tiffin' },
      { text: 'Log dinner tiffin for today', tool: 'log_tiffin' },
      { text: 'Tiffin entry for today', tool: 'log_tiffin' },
      { text: 'How many tiffins this month?', tool: 'query_tiffin' },
      { text: 'Show my tiffin history', tool: 'query_tiffin' },
      { text: 'What is my tiffin bill this month?', tool: 'query_tiffin' },
      { text: 'Show tiffin expenses', tool: 'query_tiffin' },
      { text: 'How much do I owe for tiffin?', tool: 'query_tiffin' },
      { text: 'How many meals logged in tiffin?', tool: 'query_tiffin' },
      { text: 'Check tiffin balance', tool: 'query_tiffin' },
      { text: 'Show tiffin tracker', tool: 'navigate_app' },
      { text: 'Open tiffin', tool: 'navigate_app' },
      { text: 'Go to tiffin tracker', tool: 'navigate_app' },
      { text: 'Navigate to tiffin', tool: 'navigate_app' },
      { text: 'Show my tiffin log', tool: 'query_tiffin' },
      { text: 'Calculate tiffin spending', tool: 'query_tiffin' },
      { text: 'Tiffin summary for last month', tool: 'query_tiffin' },
      { text: 'How many lunches logged this month?', tool: 'query_tiffin' },
    ];

    tiffinCases.forEach((c, idx) => {
      it(`Case 4.${idx + 1}: "${c.text}" -> ${c.tool}`, () => {
        const res = parseDeterministicFallback(c.text);
        assert.equal(res.toolName, c.tool);
      });
    });
  });

  // ── 5. Split Expenses & Group Balances (20 Cases) ──────────────────────────
  describe('Group 5: Split Bill & Group Dues Operations', () => {
    const splitCases = [
      { text: 'Who owes me money?', tool: 'query_splits' },
      { text: 'What do I owe in split bills?', tool: 'query_splits' },
      { text: 'Show split balances', tool: 'query_splits' },
      { text: 'Check my group dues', tool: 'query_splits' },
      { text: 'Who has not paid me back?', tool: 'query_splits' },
      { text: 'Show my split groups', tool: 'navigate_app' },
      { text: 'Open split expenses', tool: 'navigate_app' },
      { text: 'Go to splits', tool: 'navigate_app' },
      { text: 'Navigate to split bills', tool: 'navigate_app' },
      { text: 'Split 1500 for dinner with friends', tool: 'create_split' },
      { text: 'Split bill of 1200 for lunch', tool: 'create_split' },
      { text: 'Create split of 3000 for goa trip', tool: 'create_split' },
      { text: 'Split 600 for pizza', tool: 'create_split' },
      { text: 'Split 2400 hotel room', tool: 'create_split' },
      { text: 'Split 450 for cab fare', tool: 'create_split' },
      { text: 'Check outstanding split balances', tool: 'query_splits' },
      { text: 'Show all my split expenses', tool: 'navigate_app' },
      { text: 'Who owes what in split bills?', tool: 'query_splits' },
      { text: 'How much do friends owe me?', tool: 'query_splits' },
      { text: 'Check split group debts', tool: 'query_splits' },
    ];

    splitCases.forEach((c, idx) => {
      it(`Case 5.${idx + 1}: "${c.text}" -> ${c.tool}`, () => {
        const res = parseDeterministicFallback(c.text);
        assert.equal(res.toolName, c.tool);
      });
    });
  });

  // ── 6. Application Navigation (20 Cases) ──────────────────────────────────
  describe('Group 6: In-App Direct Navigation', () => {
    const navCases = [
      { text: 'Open dashboard', screen: 'MainTabs' },
      { text: 'Go to home', screen: 'MainTabs' },
      { text: 'Take me to expenses', screen: 'Expenses' },
      { text: 'Show all expenses', screen: 'Expenses' },
      { text: 'Open reports', screen: 'Analytics' },
      { text: 'Open analytics', screen: 'Analytics' },
      { text: 'Go to analytics', screen: 'Analytics' },
      { text: 'Show recurring subscriptions', screen: 'Recurring' },
      { text: 'Open subscriptions', screen: 'Recurring' },
      { text: 'Go to settings', screen: 'ExpenseTrackerSettings' },
      { text: 'Open settings', screen: 'ExpenseTrackerSettings' },
      { text: 'Show my profile', screen: 'Profile' },
      { text: 'Open profile', screen: 'Profile' },
      { text: 'Take me to account settings', screen: 'ExpenseTrackerSettings' },
      { text: 'Open tiffin tracker', screen: 'TiffinTransactions' },
      { text: 'Go to split bills', screen: 'SplitTransactions' },
      { text: 'Add an expense screen', screen: 'Expenses' },
      { text: 'Open add expense', screen: 'Expenses' },
      { text: 'Navigate to recurring payments', screen: 'Recurring' },
      { text: 'Take me to home dashboard', screen: 'MainTabs' },
    ];

    navCases.forEach((c, idx) => {
      it(`Case 6.${idx + 1}: "${c.text}" -> navigate to ${c.screen}`, () => {
        const res = parseDeterministicFallback(c.text);
        assert.equal(res.toolName, 'navigate_app');
        assert.equal(res.params.screenTarget, c.screen);
      });
    });
  });

  // ── 7. Ambiguity, Missing Entities & Clarification (15 Cases) ─────────────
  describe('Group 7: Ambiguous Utterances Requiring Clarification', () => {
    const clarCases = [
      { text: 'Spent on petrol', missing: 'amount' },
      { text: 'Spent 400 and 250 on groceries', missing: 'amount' },
      { text: 'Add expense yesterday', missing: 'amount' },
      { text: 'Log food expense', missing: 'amount' },
      { text: 'Paid for uber ride', missing: 'amount' },
      { text: 'Bought dinner', missing: 'amount' },
      { text: 'Recharge done', missing: 'amount' },
      { text: 'Spent 300 or 400 on lunch', missing: 'amount' },
      { text: 'Paid doctor fee', missing: 'amount' },
      { text: 'Swiped credit card', missing: 'amount' },
      { text: 'Bought coffee', missing: 'amount' },
      { text: 'Log expense 500 and 600', missing: 'amount' },
      { text: 'Paid electricity', missing: 'amount' },
      { text: 'Recorded transaction', missing: 'amount' },
      { text: 'Spent money on clothes', missing: 'amount' },
    ];

    clarCases.forEach((c, idx) => {
      it(`Case 7.${idx + 1}: "${c.text}" -> asks for ${c.missing}`, () => {
        const res = parseDeterministicFallback(c.text);
        assert.equal(res.toolName, 'request_clarification');
        assert.equal(res.params.missingField, c.missing);
      });
    });
  });

  // ── 8. Adversarial, Safety & Control Guardrails (10 Cases) ────────────────
  describe('Group 8: Adversarial Prompts & Guardrails', () => {
    it('Case 8.1: Undo last expense only when explicitly requested', () => {
      const res = parseDeterministicFallback('Undo the last expense');
      assert.equal(res.toolName, 'undo_last_expense');
    });

    it('Case 8.2: Delete last expense maps to delete_expense', () => {
      const res = parseDeterministicFallback('Delete my last expense');
      assert.equal(res.toolName, 'delete_expense');
    });

    it('Case 8.3: General help question returns general_answer', () => {
      const res = parseDeterministicFallback('Who are you and what can you do?');
      assert.equal(res.toolName, 'general_answer');
    });

    it('Case 8.4: Greeting returns general_answer', () => {
      const res = parseDeterministicFallback('Hello good morning');
      assert.equal(res.toolName, 'general_answer');
    });

    it('Case 8.5: App capabilities query returns general_answer', () => {
      const res = parseDeterministicFallback('How do I use this app?');
      assert.equal(res.toolName, 'general_answer');
    });

    it('Case 8.6: Non-transaction statement returns general_answer', () => {
      const res = parseDeterministicFallback('I love pizza');
      assert.equal(res.toolName, 'general_answer');
    });

    it('Case 8.7: Sign out request routes safely to profile screen without auto-signout', () => {
      const res = parseDeterministicFallback('Log me out');
      assert.equal(res.toolName, 'navigate_app');
      assert.equal(res.params.screenTarget, 'Profile');
    });

    it('Case 8.8: Password change routes safely to settings', () => {
      const res = parseDeterministicFallback('I want to change my password');
      assert.equal(res.toolName, 'navigate_app');
      assert.equal(res.params.screenTarget, 'ExpenseTrackerSettings');
    });

    it('Case 8.9: Random gibberish returns general_answer help', () => {
      const res = parseDeterministicFallback('asdfghjkl qwerty 123');
      assert.equal(res.toolName, 'general_answer');
    });

    it('Case 8.10: Update last expense maps to update_expense', () => {
      const res = parseDeterministicFallback('Change the amount of my last expense to 300');
      assert.equal(res.toolName, 'update_expense');
      assert.equal(res.params.updates.amount, 300);
    });
  });

});
