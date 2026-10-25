/**
 * Navigation Registry
 * 
 * Maps natural language requests and canonical screen IDs to verified routes
 * registered in RootNavigator.tsx and BottomTabNavigator.tsx.
 * 
 * Guarantees:
 * - Never returns arbitrary or unverified route strings
 * - Navigating to Profile / Settings never automatically triggers sign-out
 */

const ALLOWED_SCREENS = {
  Expenses: {
    screenId: 'Expenses',
    title: 'All Expenses',
    tab: 'ExpensesTxns',
    description: 'View full transaction history, search and filter expenses',
    aliases: ['expenses', 'expense list', 'transaction list', 'transactions', 'txns', 'all expenses', 'view expenses', 'open expenses'],
  },
  Analytics: {
    screenId: 'Analytics',
    title: 'Analytics & Insights',
    tab: 'ExpensesAnalytics',
    description: 'Visual expense breakdowns, charts, and monthly trends',
    aliases: ['analytics', 'reports', 'monthly reports', 'insights', 'spending chart', 'charts', 'stats', 'graphs', 'breakdown'],
  },
  MainTabs: {
    screenId: 'MainTabs',
    title: 'Dashboard',
    tab: 'ExpensesDashboard',
    description: 'Main overview dashboard with recent activity and cash flow',
    aliases: ['dashboard', 'home', 'main screen', 'overview', 'summary'],
  },
  TiffinTransactions: {
    screenId: 'TiffinTransactions',
    title: 'Tiffin Tracker',
    tab: 'TiffinHome',
    description: 'Tiffin meal history, logged meals, and monthly billing',
    aliases: ['tiffin', 'tiffin tracker', 'tiffin history', 'tiffin meals', 'meals', 'tiffin transactions', 'tiffin bills'],
  },
  SplitTransactions: {
    screenId: 'SplitTransactions',
    title: 'Split Expenses',
    tab: 'SplitGroups',
    description: 'Split bill groups, shared expenses, and who owes who',
    aliases: ['split', 'splits', 'split expenses', 'split bills', 'group expenses', 'split history', 'shared expenses'],
  },
  Recurring: {
    screenId: 'Recurring',
    title: 'Recurring Subscriptions',
    tab: 'ExpensesRecurring',
    description: 'Manage active subscriptions and recurring payments',
    aliases: ['recurring', 'subscriptions', 'recurring expenses', 'active subscriptions', 'bills subscription'],
  },
  Profile: {
    screenId: 'Profile',
    title: 'Account & Settings',
    tab: 'ProfileTab',
    description: 'Manage account profile, preferences, and security. Sign out can be accessed safely here.',
    aliases: ['profile', 'account', 'sign out', 'logout', 'log out', 'user details', 'where can i sign out', 'where do i logout'],
  },
  ExpenseTrackerSettings: {
    screenId: 'ExpenseTrackerSettings',
    title: 'Tracker Settings',
    description: 'Customize category thresholds, budgets, and display settings',
    aliases: ['settings', 'tracker settings', 'app settings', 'budget settings', 'preferences'],
  },
  TiffinSettings: {
    screenId: 'TiffinSettings',
    title: 'Tiffin Settings',
    description: 'Configure tiffin group rates, default meal prices, and preferences',
    aliases: ['tiffin settings', 'tiffin config', 'meal rate settings'],
  },
  SmsPendingReview: {
    screenId: 'SmsPendingReview',
    title: 'Pending SMS Expenses',
    description: 'Review auto-detected SMS payments pending category confirmation',
    aliases: ['sms review', 'pending sms', 'auto detected', 'sms expenses', 'notifications review'],
  },
};

/**
 * Validates whether a screen ID is registered and allowed.
 * @param {string} screenId 
 * @returns {boolean}
 */
function isValidScreen(screenId) {
  if (!screenId || typeof screenId !== 'string') return false;
  return Object.prototype.hasOwnProperty.call(ALLOWED_SCREENS, screenId);
}

/**
 * Resolves a natural-language query or identifier to a canonical registered screen.
 * @param {string} input 
 * @returns {{ screenId: string, title: string, description: string, tab?: string } | null}
 */
function resolveNavigation(input) {
  if (!input || typeof input !== 'string') return null;
  const clean = input.toLowerCase().trim();

  // 1. Direct match on screenId (case-insensitive)
  for (const [key, config] of Object.entries(ALLOWED_SCREENS)) {
    if (key.toLowerCase() === clean) {
      return {
        screenId: config.screenId,
        title: config.title,
        description: config.description,
        tab: config.tab,
      };
    }
  }

  // Flatten all aliases sorted by length descending so longer phrases match first
  const allAliases = [];
  for (const config of Object.values(ALLOWED_SCREENS)) {
    for (const alias of config.aliases) {
      allAliases.push({ alias: alias.toLowerCase(), config });
    }
  }
  allAliases.sort((a, b) => b.alias.length - a.alias.length);

  // 2. Exact match on alias
  for (const item of allAliases) {
    if (clean === item.alias) {
      return {
        screenId: item.config.screenId,
        title: item.config.title,
        description: item.config.description,
        tab: item.config.tab,
      };
    }
  }

  // 3. Substring match ONLY if navigation intent verb is present or exact word boundary matches
  const hasNavVerb = /\b(open|show|go to|take me to|navigate to|view|where is|where do i|where can i|head to|jump to)\b/i.test(clean);
  if (hasNavVerb) {
    for (const item of allAliases) {
      const regex = new RegExp(`\\b${item.alias.replace(/\s+/g, '\\s+')}\\b`, 'i');
      if (regex.test(clean)) {
        return {
          screenId: item.config.screenId,
          title: item.config.title,
          description: item.config.description,
          tab: item.config.tab,
        };
      }
    }
  }

  return null;
}


/**
 * Returns list of all navigatable screens for user help / prompt context.
 */
function getNavigableScreensList() {
  return Object.values(ALLOWED_SCREENS).map((s) => ({
    screenId: s.screenId,
    title: s.title,
    description: s.description,
  }));
}

module.exports = {
  ALLOWED_SCREENS,
  isValidScreen,
  resolveNavigation,
  getNavigableScreensList,
};
