/**
 * Grounded Financial Query Engine
 * 
 * Executes read-only queries against MongoDB and performs all calculations
 * (sums, percentages, balances, meal costs) in deterministic application code.
 * 
 * Non-negotiable rule:
 * - Personal financial totals are NEVER generated from LLM memory.
 */

const Expense = require('../models/Expense');
const Category = require('../models/Category');
const Budget = require('../models/Budget');
const SplitExpense = require('../models/SplitExpense');
const SplitGroup = require('../models/SplitGroup');
const TiffinEntry = require('../models/TiffinEntry');
const TiffinGroup = require('../models/TiffinGroup');

// High-speed in-memory RAM cache for repeated financial read queries (30s TTL)
const queryCache = new Map();
const QUERY_CACHE_TTL_MS = 30 * 1000;

function invalidateUserQueryCache(userId) {
  if (!userId) return;
  const prefix = String(userId) + ':';
  for (const key of queryCache.keys()) {
    if (key.startsWith(prefix)) {
      queryCache.delete(key);
    }
  }
}

/**
 * Deterministic calculation of expense totals, counts, and category breakdowns.
 */
async function queryExpensesSummary({ userId, category, month, search, startDate, endDate, limit = 100 }) {
  const cacheKey = `${userId}:exp:${category || ''}:${month || ''}:${search || ''}:${startDate || ''}:${endDate || ''}:${limit}`;
  const now = Date.now();
  const cached = queryCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.data;
  }
  const query = { userId };

  if (category && category !== 'All') {
    query.category = new RegExp(`^${category.trim()}$`, 'i');
  }

  if (search) {
    query.title = { $regex: search.trim(), $options: 'i' };
  }

  if (month && month !== 'all') {
    const [year, m] = month.split('-').map(Number);
    if (year && m) {
      const startOfMonth = new Date(Date.UTC(year, m - 1, 1, 0, 0, 0, 0));
      const endOfMonth = new Date(Date.UTC(year, m, 1, 0, 0, 0, 0));
      query.date = { $gte: startOfMonth, $lt: endOfMonth };
    }
  } else if (startDate || endDate) {
    query.date = {};
    if (startDate) query.date.$gte = new Date(startDate);
    if (endDate) query.date.$lte = new Date(endDate);
  }

  const expenses = await Expense.find(query).sort({ date: -1 }).limit(parseInt(limit, 10) || 100);

  let totalAmount = 0;
  const byCategory = {};
  const byPaymentMethod = {};

  for (const exp of expenses) {
    const amt = Number(exp.amount) || 0;
    totalAmount += amt;

    const cat = exp.category || 'Others';
    byCategory[cat] = (byCategory[cat] || 0) + amt;

    const method = exp.paymentMethod || 'UPI';
    byPaymentMethod[method] = (byPaymentMethod[method] || 0) + amt;
  }

  // Sort categories by highest spend
  const sortedCategories = Object.entries(byCategory)
    .map(([name, amount]) => ({ name, amount: Math.round(amount * 100) / 100 }))
    .sort((a, b) => b.amount - a.amount);

  const result = {
    totalAmount: Math.round(totalAmount * 100) / 100,
    count: expenses.length,
    period: month || (startDate && endDate ? `${startDate} to ${endDate}` : 'All time'),
    topCategory: sortedCategories[0] || null,
    categoryBreakdown: sortedCategories,
    paymentMethodBreakdown: byPaymentMethod,
    recentExpenses: expenses.slice(0, 5).map((e) => ({
      id: String(e._id),
      title: e.title,
      amount: e.amount,
      category: e.category,
      date: e.date,
      paymentMethod: e.paymentMethod,
    })),
  };

  queryCache.set(cacheKey, { data: result, expiresAt: now + QUERY_CACHE_TTL_MS });
  return result;
}

/**
 * Deterministic calculation of monthly budget status, limits, and critical alerts.
 */
async function queryBudgetStatus({ userId, month, category }) {
  const cacheKey = `${userId}:budget:${month || ''}:${category || ''}`;
  const now = Date.now();
  const cached = queryCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.data;
  }

  const dateNow = new Date();
  const targetMonth = month || `${dateNow.getFullYear()}-${String(dateNow.getMonth() + 1).padStart(2, '0')}`;

  const [year, m] = targetMonth.split('-').map(Number);
  const startOfMonth = new Date(Date.UTC(year, m - 1, 1, 0, 0, 0, 0));
  const endOfMonth = new Date(Date.UTC(year, m, 1, 0, 0, 0, 0));

  const [categories, monthExpenses, storedBudgets] = await Promise.all([
    Category.find({ userId }),
    Expense.find({ userId, date: { $gte: startOfMonth, $lt: endOfMonth } }),
    Budget.find({ userId, month: targetMonth }),
  ]);

  const spentByCategory = {};
  for (const exp of monthExpenses) {
    const catName = exp.category || 'Others';
    spentByCategory[catName] = (spentByCategory[catName] || 0) + (exp.amount || 0);
  }

  let totalLimit = 0;
  let totalSpent = 0;

  const categoryStatuses = categories.map((cat) => {
    const limit = cat.limit || 5000;
    const spent = spentByCategory[cat.name] || 0;
    const percentage = limit > 0 ? Math.round((spent / limit) * 100) : 0;
    const remaining = Math.max(0, limit - spent);

    totalLimit += limit;
    totalSpent += spent;

    let status = 'normal';
    if (percentage >= (cat.criticalThreshold || 95)) status = 'critical';
    else if (percentage >= (cat.warningThreshold || 80)) status = 'warning';

    return {
      categoryId: String(cat._id),
      categoryName: cat.name,
      limit,
      spent: Math.round(spent * 100) / 100,
      remaining: Math.round(remaining * 100) / 100,
      percentage,
      status,
      warningThreshold: cat.warningThreshold || 80,
      criticalThreshold: cat.criticalThreshold || 95,
    };
  });

  // Filter for specific category if requested
  const filtered = category
    ? categoryStatuses.filter((c) => c.categoryName.toLowerCase() === category.toLowerCase())
    : categoryStatuses;

  const overallPercentage = totalLimit > 0 ? Math.round((totalSpent / totalLimit) * 100) : 0;

  const result = {
    month: targetMonth,
    totalLimit: Math.round(totalLimit * 100) / 100,
    totalSpent: Math.round(totalSpent * 100) / 100,
    totalRemaining: Math.round(Math.max(0, totalLimit - totalSpent) * 100) / 100,
    overallPercentage,
    categories: filtered,
    closestToBudget: [...categoryStatuses].sort((a, b) => b.percentage - a.percentage)[0] || null,
  };

  queryCache.set(cacheKey, { data: result, expiresAt: now + QUERY_CACHE_TTL_MS });
  return result;
}

/**
 * Deterministic calculation of split balances: who owes whom and net standing.
 */
async function querySplitSummary({ userId }) {
  const cacheKey = `${userId}:split`;
  const now = Date.now();
  const cached = queryCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.data;
  }
  // Expenses user paid for (money owed to user)
  const paidByMe = await SplitExpense.find({ paidBy: userId });
  let totalOwedToYou = 0;

  for (const exp of paidByMe) {
    if (Array.isArray(exp.splitBetween)) {
      for (const s of exp.splitBetween) {
        if (s.userId && s.userId.toString() !== userId) {
          totalOwedToYou += Number(s.amount) || 0;
        }
      }
    }
  }

  // Expenses someone else paid for (money user owes)
  const paidByOthers = await SplitExpense.find({
    paidBy: { $ne: userId },
    'splitBetween.userId': userId,
  });
  let totalYouOwe = 0;

  for (const exp of paidByOthers) {
    if (Array.isArray(exp.splitBetween)) {
      const mySplit = exp.splitBetween.find((s) => s.userId && s.userId.toString() === userId);
      if (mySplit) {
        totalYouOwe += Number(mySplit.amount) || 0;
      }
    }
  }

  const groups = await SplitGroup.find({
    $or: [{ createdBy: userId }, { 'members.userId': userId }],
  });

  const result = {
    totalOwedToYou: Math.round(totalOwedToYou * 100) / 100,
    totalYouOwe: Math.round(totalYouOwe * 100) / 100,
    netBalance: Math.round((totalOwedToYou - totalYouOwe) * 100) / 100,
    activeGroupsCount: groups.length,
    statusMessage:
      totalOwedToYou > totalYouOwe
        ? `You are owed ₹${Math.round(totalOwedToYou - totalYouOwe)} in net balance across groups.`
        : totalYouOwe > totalOwedToYou
        ? `You owe ₹${Math.round(totalYouOwe - totalOwedToYou)} in net balance across groups.`
        : 'All shared split balances are settled up.',
  };

  queryCache.set(cacheKey, { data: result, expiresAt: now + QUERY_CACHE_TTL_MS });
  return result;
}

/**
 * Deterministic calculation of tiffin meals, pricing, and counts.
 */
async function queryTiffinSummary({ userId, month, date }) {
  const cacheKey = `${userId}:tiffin:${month || ''}:${date || ''}`;
  const now = Date.now();
  const cached = queryCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.data;
  }
  const query = { userId, noTiffin: { $ne: true } };

  if (date) {
    const dayStart = new Date(date);
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setUTCHours(23, 59, 59, 999);
    query.date = { $gte: dayStart, $lte: dayEnd };
  } else if (month && month !== 'all') {
    const [year, m] = month.split('-').map(Number);
    if (year && m) {
      const startOfMonth = new Date(Date.UTC(year, m - 1, 1, 0, 0, 0, 0));
      const endOfMonth = new Date(Date.UTC(year, m, 1, 0, 0, 0, 0));
      query.date = { $gte: startOfMonth, $lt: endOfMonth };
    }
  }

  const entries = await TiffinEntry.find(query).sort({ date: -1 });

  let totalMeals = 0;
  let totalCost = 0;
  const byMealType = { lunch: 0, dinner: 0, breakfast: 0 };

  for (const entry of entries) {
    const qty = entry.quantity || entry.count || 1;
    totalMeals += qty;
    totalCost += Number(entry.totalPrice) || 0;

    const mType = (entry.mealType || 'lunch').toLowerCase();
    byMealType[mType] = (byMealType[mType] || 0) + qty;
  }

  const result = {
    totalMeals,
    totalCost: Math.round(totalCost * 100) / 100,
    byMealType,
    entriesCount: entries.length,
    recentEntries: entries.slice(0, 5).map((e) => ({
      id: String(e._id),
      mealType: e.mealType,
      quantity: e.quantity || e.count || 1,
      totalPrice: e.totalPrice,
      date: e.date,
    })),
  };

  queryCache.set(cacheKey, { data: result, expiresAt: now + QUERY_CACHE_TTL_MS });
  return result;
}

module.exports = {
  queryExpensesSummary,
  queryBudgetStatus,
  querySplitSummary,
  queryTiffinSummary,
  invalidateUserQueryCache,
};
