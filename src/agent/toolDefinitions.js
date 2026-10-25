/**
 * Agent Tool Definitions
 * 
 * Strict OpenAI / Groq compatible tool calling specifications.
 * Enforces typed schemas for expense operations, financial queries,
 * tiffin logging, split tracking, and navigation.
 */

const AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'create_expense',
      description: 'Prepare or log an expense transaction with amount, category, payment method and date.',
      parameters: {
        type: 'object',
        properties: {
          amount: {
            type: 'number',
            description: 'Monetary amount spent in INR (₹). Must be greater than 0.',
          },
          category: {
            type: 'string',
            description: 'Category name or natural language alias (e.g. "petrol", "groceries", "food", "Food & Dining").',
          },
          title: {
            type: 'string',
            description: 'Brief title or merchant name (e.g. "Starbucks Coffee", "Shell Petrol", "Grocery shopping").',
          },
          paymentMethod: {
            type: 'string',
            enum: ['UPI', 'Cash', 'Credit Card', 'Debit Card', 'Net Banking'],
            description: 'Method of payment. Defaults to UPI if not specified.',
          },
          date: {
            type: 'string',
            description: 'ISO 8601 date string or relative date keyword (e.g. "today", "yesterday", "2026-10-24").',
          },
          notes: {
            type: 'string',
            description: 'Optional additional context or notes.',
          },
          isExplicitDate: {
            type: 'boolean',
            description: 'True if user explicitly mentioned a date (like yesterday or Oct 12); false if today was assumed.',
          },
        },
        required: ['amount'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_expenses',
      description: 'Query personal expense history, totals, or category spending. Performs calculations deterministically in app code.',
      parameters: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            description: 'Filter by category name (e.g. "Food & Dining", "Travel & Commute", "all").',
          },
          search: {
            type: 'string',
            description: 'Search keyword matching title or notes.',
          },
          month: {
            type: 'string',
            description: 'Target month in YYYY-MM format (e.g. "2026-10") or "this month", "last month".',
          },
          limit: {
            type: 'number',
            description: 'Max records to return. Default 20.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_expense',
      description: 'Modify an existing expense (e.g. change amount, category, date or payment method).',
      parameters: {
        type: 'object',
        properties: {
          targetQuery: {
            type: 'string',
            description: 'Reference to the target expense (e.g. "last expense", "the 400 petrol", or specific ID).',
          },
          updates: {
            type: 'object',
            properties: {
              amount: { type: 'number' },
              category: { type: 'string' },
              title: { type: 'string' },
              paymentMethod: { type: 'string' },
              date: { type: 'string' },
            },
            description: 'Fields to update.',
          },
        },
        required: ['targetQuery', 'updates'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_expense',
      description: 'Delete or remove an existing expense record. Requires user confirmation if ambiguous.',
      parameters: {
        type: 'object',
        properties: {
          targetQuery: {
            type: 'string',
            description: 'Reference to the target expense to remove (e.g. "last expense", "the coffee from today", or specific ID).',
          },
        },
        required: ['targetQuery'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'undo_last_expense',
      description: 'Revert or undo the most recently created expense transaction.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_budget',
      description: 'Check budget limits, actual spending, and threshold status for a month or category.',
      parameters: {
        type: 'object',
        properties: {
          month: {
            type: 'string',
            description: 'Month in YYYY-MM format or "this month".',
          },
          category: {
            type: 'string',
            description: 'Optional category name to filter (e.g. "Food & Dining").',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_splits',
      description: 'Check shared bill balances, total owed to user, total user owes, and group summaries.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_split',
      description: 'Create a new split expense among group members.',
      parameters: {
        type: 'object',
        properties: {
          description: {
            type: 'string',
            description: 'Bill description (e.g. "Dinner at BBQ Nation").',
          },
          amount: {
            type: 'number',
            description: 'Total bill amount to split.',
          },
          groupName: {
            type: 'string',
            description: 'Target group name if user has multiple split groups.',
          },
        },
        required: ['description', 'amount'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'log_tiffin',
      description: 'Log a tiffin meal (lunch/dinner/breakfast) for today or a specific date.',
      parameters: {
        type: 'object',
        properties: {
          mealType: {
            type: 'string',
            enum: ['lunch', 'dinner', 'breakfast'],
            description: 'Type of meal being logged.',
          },
          date: {
            type: 'string',
            description: 'Date of the meal (ISO string or relative like "today", "yesterday").',
          },
          count: {
            type: 'number',
            description: 'Number of meals (default 1).',
          },
          notes: {
            type: 'string',
            description: 'Optional notes regarding the meal.',
          },
        },
        required: ['mealType'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_tiffin',
      description: 'Query tiffin meal counts, monthly bill total, and delivery history.',
      parameters: {
        type: 'object',
        properties: {
          month: {
            type: 'string',
            description: 'Month in YYYY-MM format or "this month".',
          },
          date: {
            type: 'string',
            description: 'Specific date to check.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'navigate_app',
      description: 'Navigate the mobile application to a registered screen (e.g. Expenses, Reports, Tiffin, Splits, Profile).',
      parameters: {
        type: 'object',
        properties: {
          screenTarget: {
            type: 'string',
            description: 'Target screen name or key (e.g. "Expenses", "Analytics", "TiffinTransactions", "SplitTransactions", "Profile", "Recurring", "ExpenseTrackerSettings").',
          },
          reason: {
            type: 'string',
            description: 'Explanation for navigation to show user in the action card.',
          },
        },
        required: ['screenTarget'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'request_clarification',
      description: 'Ask user for missing required information or clarify ambiguous choices (e.g. missing amount, ambiguous category).',
      parameters: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description: 'Clarification question to present to the user.',
          },
          options: {
            type: 'array',
            items: { type: 'string' },
            description: 'Suggested quick-reply options/chips for the user to tap.',
          },
          missingField: {
            type: 'string',
            description: 'The field that needs clarification (e.g. "amount", "category", "targetRecord").',
          },
        },
        required: ['question', 'options'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'general_answer',
      description: 'Provide a helpful, grounded financial explanation or guide the user on how to use XpenseFlow features.',
      parameters: {
        type: 'object',
        properties: {
          response: {
            type: 'string',
            description: 'Helpful message or advice formatted in markdown.',
          },
        },
        required: ['response'],
      },
    },
  },
];

module.exports = {
  AGENT_TOOLS,
};
