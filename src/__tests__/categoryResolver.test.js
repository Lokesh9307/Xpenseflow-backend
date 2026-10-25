const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { resolveCategoryFromList } = require('../agent/categoryResolver');

describe('Category Resolver Tests', () => {
  const mockUserCategories = [
    { _id: 'cat_food_1', name: 'Food & Dining', limit: 8000 },
    { _id: 'cat_travel_2', name: 'Travel & Commute', limit: 4000 },
    { _id: 'cat_shop_3', name: 'Shopping', limit: 5000 },
    { _id: 'cat_bills_4', name: 'Bills & Utilities', limit: 6000 },
    { _id: 'cat_ent_5', name: 'Entertainment', limit: 3000 },
    { _id: 'cat_oth_6', name: 'Others', limit: 3000 },
  ];

  it('resolves exact category name (case-insensitive)', () => {
    const res = resolveCategoryFromList('Food & Dining', 'Spent 500 on Food & Dining', mockUserCategories);
    assert.equal(res.resolved, true);
    assert.equal(res.categoryId, 'cat_food_1');
    assert.equal(res.categoryName, 'Food & Dining');
  });

  it('resolves petrol strictly to Travel & Commute (NEVER Food)', () => {
    const res = resolveCategoryFromList('petrol', '400 on petrol', mockUserCategories);
    assert.equal(res.resolved, true);
    assert.equal(res.categoryId, 'cat_travel_2');
    assert.equal(res.categoryName, 'Travel & Commute');
  });

  it('resolves fuel, diesel, shell, uber, ola to Travel & Commute', () => {
    for (const phrase of ['fuel', 'diesel', 'shell', 'uber', 'ola', 'auto']) {
      const res = resolveCategoryFromList(phrase, `Spent 200 on ${phrase}`, mockUserCategories);
      assert.equal(res.resolved, true, `Failed for phrase: ${phrase}`);
      assert.equal(res.categoryName, 'Travel & Commute');
    }
  });

  it('resolves starbucks, coffee, pizza, burger, swiggy, zomato to Food & Dining', () => {
    for (const phrase of ['starbucks', 'coffee', 'pizza', 'burger', 'swiggy', 'zomato']) {
      const res = resolveCategoryFromList(phrase, `Spent 300 on ${phrase}`, mockUserCategories);
      assert.equal(res.resolved, true, `Failed for phrase: ${phrase}`);
      assert.equal(res.categoryName, 'Food & Dining');
    }
  });

  it('resolves electricity, wifi, rent to Bills & Utilities', () => {
    for (const phrase of ['electricity', 'wifi', 'rent', 'water bill']) {
      const res = resolveCategoryFromList(phrase, `Paid 1500 for ${phrase}`, mockUserCategories);
      assert.equal(res.resolved, true, `Failed for phrase: ${phrase}`);
      assert.equal(res.categoryName, 'Bills & Utilities');
    }
  });

  it('maps groceries to Food & Dining when user has no dedicated Groceries category', () => {
    const res = resolveCategoryFromList('groceries', 'Spent 1200 on groceries', mockUserCategories);
    assert.equal(res.resolved, true);
    assert.equal(res.categoryName, 'Food & Dining');
  });

  it('maps groceries to dedicated Groceries category when user has one', () => {
    const customCats = [
      ...mockUserCategories,
      { _id: 'cat_groc_7', name: 'Groceries', limit: 7000 },
    ];
    const res = resolveCategoryFromList('groceries', 'Spent 1200 on groceries', customCats);
    assert.equal(res.resolved, true);
    assert.equal(res.categoryId, 'cat_groc_7');
    assert.equal(res.categoryName, 'Groceries');
  });

  it('never silently substitutes an unknown category and asks for clarification', () => {
    const res = resolveCategoryFromList('cryptocurrency mining equipment', 'Spent 50000 on cryptocurrency mining equipment', mockUserCategories);
    assert.equal(res.resolved, false);
    assert.equal(res.confidence, 0);
    assert.ok(res.reason);
    assert.ok(res.candidates.length > 0);
  });
});
