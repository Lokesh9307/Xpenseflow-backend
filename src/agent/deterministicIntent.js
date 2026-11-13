/**
 * Deterministic, grounded intent parser used when the model is unavailable and
 * as a safety fallback for ambiguous input. It intentionally favours asking a
 * clarification over guessing a financial amount or category.
 */

const { resolveNavigation } = require('./navigationRegistry');
const { ARCHETYPE_ALIASES } = require('./categoryResolver');

const PAYMENT_METHODS = ['UPI', 'Cash', 'Credit Card', 'Debit Card', 'Net Banking'];

const NAV_VERB = /\b(open|go to|take me|navigate to|jump to|head to|where is|where can i|where do i)\b/i;
const STRONG_QUERY =
  /\b(how much|how many|what did i spend|what have i spent|what'?s my|what is my|total|summary|breakdown|top category|biggest|largest|highest|where did|compare|recent|latest|last few|last\s+(?:transaction|expense|payment)|remaining|left to spend)\b/i;
const CREATE_EXPENSE =
  /\b(spent|paid|bought|purchased|cost me|put|charged|swiped|grabbed|filled|ordered|order|bill|fee|membership|ticket|tickets|fare|rent|recharge|break|had)\b|\b(add|log|record|create|save)\b[\s\S]{0,30}\b(expense|expenses|purchase|transaction)\b|\b(add|log|record|put)\b[\s\S]{0,30}\b\d|\b(expense|purchase)\s+(?:of|for)\b/i;

const CATEGORY_PATTERNS = [
  ['Groceries', /grocer|supermarket|vegetable|sabzi|milk|bread|egg|blinkit|zepto|instamart|bigbasket|dmart|ration/i],
  ['Travel & Commute', /petrol|fuel|diesel|cng|uber|ola|rapido|cab|taxi|auto|metro|train|flight|toll|parking|commute|travel|car wash/i],
  ['Food & Dining', /coffee|tea|chai|starbucks|cafe|restaurant|swiggy(?!\s*instamart)|zomato|pizza|burger|biryani|dinner|lunch|breakfast|snack|food|dining|dine|eat|sweets|mithai/i],
  ['Shopping', /cloth|shirt|shoes|zara|h&m|myntra|amazon|flipkart|shopping|electronics|gadget|mall|stationery|office/i],
  ['Bills & Utilities', /electricity|wifi|broadband|internet|recharge|rent|bill|utility|gas|cylinder|water bill|maintenance/i],
  ['Entertainment', /entertainment|movie|cinema|pvr|inox|netflix|prime|hotstar|spotify|concert|game|gaming|steam/i],
  ['Health & Medical', /medicine|meds|pharmacy|doctor|hospital|clinic|health|gym|fitness|dentist/i],
];

function cleanText(message) {
  return String(message || '').replace(/\s+/g, ' ').trim();
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== '')
  );
}

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

function toMonthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function extractPeriod(text) {
  const now = new Date();
  const lower = text.toLowerCase();

  if (/\b(day before yesterday)\b/i.test(lower)) {
    const d = new Date(now);
    d.setDate(d.getDate() - 2);
    return { startDate: startOfDay(d).toISOString(), endDate: endOfDay(d).toISOString(), label: 'the day before yesterday' };
  }
  if (/\byesterday\b/i.test(lower)) {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    return { startDate: startOfDay(d).toISOString(), endDate: endOfDay(d).toISOString(), label: 'yesterday' };
  }
  if (/\btoday\b/i.test(lower)) {
    return { startDate: startOfDay(now).toISOString(), endDate: endOfDay(now).toISOString(), label: 'today' };
  }
  if (/\blast month\b/i.test(lower)) {
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return { month: toMonthKey(d), label: 'last month' };
  }
  if (/\bthis month\b/i.test(lower)) {
    return { month: toMonthKey(now), label: 'this month' };
  }
  if (/\blast week\b/i.test(lower)) {
    const start = new Date(now);
    start.setDate(start.getDate() - 7);
    return { startDate: startOfDay(start).toISOString(), endDate: endOfDay(now).toISOString(), label: 'the last 7 days' };
  }
  if (/\bthis week\b/i.test(lower)) {
    const start = new Date(now);
    const day = start.getDay();
    start.setDate(start.getDate() - (day === 0 ? 6 : day - 1));
    return { startDate: startOfDay(start).toISOString(), endDate: endOfDay(now).toISOString(), label: 'this week' };
  }
  const lastDays = lower.match(/\blast\s+(\d{1,2})\s+days?\b/i);
  if (lastDays) {
    const start = new Date(now);
    start.setDate(start.getDate() - Number(lastDays[1]));
    return { startDate: startOfDay(start).toISOString(), endDate: endOfDay(now).toISOString(), label: `the last ${lastDays[1]} days` };
  }
  if (/\ball time\b|\boverall\b|\bso far\b/i.test(lower)) {
    return { label: 'all time' };
  }

  const yearMatch = lower.match(/\b((?:19|20)\d{2})\b/);
  if (yearMatch) {
    const year = Number(yearMatch[1]);
    return {
      startDate: new Date(year, 0, 1).toISOString(),
      endDate: new Date(year, 11, 31, 23, 59, 59, 999).toISOString(),
      label: String(year),
    };
  }

  const explicitDate = normalizeExplicitDate(lower);
  if (explicitDate.explicit && /\d/.test(lower)) {
    const date = new Date(explicitDate.date);
    if (!Number.isNaN(date.getTime())) {
      return {
        startDate: startOfDay(date).toISOString(),
        endDate: endOfDay(date).toISOString(),
        label: date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
      };
    }
  }

  return { month: toMonthKey(now), label: 'this month' };
}

function extractCategory(text) {
  let best = null;
  for (const [category, pattern] of CATEGORY_PATTERNS) {
    const match = pattern.exec(text);
    if (!match) continue;
    if (!best || match.index < best.index || (match.index === best.index && match[0].length > best.length)) {
      best = { category, index: match.index, length: match[0].length };
    }
  }
  return best?.category || 'Others';
}

function extractPaymentMethod(text) {
  if (/\bdebit\s*card\b/i.test(text)) return 'Debit Card';
  if (/\bcredit\s*card\b|\bcc\b|\b(?:on|by|with|using)\s+(?:my\s+)?card\b/i.test(text)) return 'Credit Card';
  if (/\bnet\s*banking\b|\bnetbanking\b/i.test(text)) return 'Net Banking';
  if (/\bcash\b/i.test(text)) return 'Cash';
  if (/\bupi\b|\bgoogle\s*pay\b|\bphonepe\b|\bpaytm\b/i.test(text)) return 'UPI';
  return 'UPI';
}

function extractLimit(text, fallback = 20) {
  const match = text.match(/\b(?:last|latest|recent)\s+(\d{1,2})\s+(?:transactions?|expenses?|purchases?)\b/i);
  if (match) return Math.min(50, Math.max(1, Number(match[1])));
  if (/\brecent\b|\blatest\b|\blast few\b/i.test(text)) return 5;
  return fallback;
}

function normalizeExplicitDate(text) {
  const lower = text.toLowerCase();
  const now = new Date();

  if (/\btoday\b/i.test(lower)) return { date: 'today', explicit: true };
  if (/\byesterday\b/i.test(lower)) return { date: 'yesterday', explicit: true };
  if (/\bday before yesterday\b/i.test(lower)) return { date: 'day before yesterday', explicit: true };

  const iso = lower.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return { date: `${iso[1]}-${iso[2]}-${iso[3]}`, explicit: true };

  const numeric = lower.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]);
    let year = numeric[3] ? Number(numeric[3]) : now.getFullYear();
    if (year < 100) year += 2000;
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return {
        date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        explicit: true,
      };
    }
  }

  const months = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
    may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9,
    sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
    dec: 12, december: 12,
  };
  const named = lower.match(/\b(?:on\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i)
    || lower.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i);
  if (named) {
    const dayFirst = /^\d+$/.test(named[1].trim());
    const day = Number(dayFirst ? named[1] : named[2]);
    const monthName = (dayFirst ? named[2] : named[1]).toLowerCase();
    const month = months[monthName.slice(0, 3)] || months[monthName];
    if (day >= 1 && day <= 31 && month) {
      return {
        date: `${now.getFullYear()}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        explicit: true,
      };
    }
  }

  return { date: 'today', explicit: false };
}

function collectCurrencyAmounts(text) {
  const results = [];
  const patterns = [
    /(?:₹|rs\.?|inr)\s*(\d{1,7}(?:,\d{3})*(?:\.\d{1,2})?)\s*(k|thousand)?/gi,
    /(\d{1,7}(?:,\d{3})*(?:\.\d{1,2})?)\s*(k|thousand)?\s*(?:₹|rs\.?|rupees?|inr|bucks?)\b/gi,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      let value = Number(match[1].replace(/,/g, ''));
      if (match[2]) value *= 1000;
      if (Number.isFinite(value) && value > 0) {
        results.push({ value: roundMoney(value), index: match.index });
      }
    }
  }
  return results;
}

/**
 * Extract a probable transaction amount. Returns { amount } or { ambiguous }.
 * Amounts tied to balances, counts, dates, times and percentages are skipped.
 */
function extractAmount(text) {
  const currencyAmounts = collectCurrencyAmounts(text);
  if (currencyAmounts.length > 0) {
    const uniq = [...new Set(currencyAmounts.map((a) => a.value))];
    if (uniq.length === 1) return { amount: uniq[0] };
    return { ambiguous: true };
  }

  const candidates = [];
  const pattern = /\b(\d{1,7}(?:,\d{3})*(?:\.\d{1,2})?)\s*(k|thousand)?\b/gi;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const raw = match[1];
    let value = Number(raw.replace(/,/g, ''));
    if (match[2]) value *= 1000;
    if (!Number.isFinite(value) || value <= 0) continue;

    const before = text.slice(Math.max(0, match.index - 28), match.index);
    const after = text.slice(match.index + match[0].length, match.index + match[0].length + 24);

    if (/^\s*(?:%|am|pm|:\d|st|nd|rd|th|km|kg|days?|weeks?|months?|years?|hours?|hrs?|minutes?|mins?|coffees?|items?|people|persons?|friends?)\b/i.test(after)) {
      continue;
    }
    if (/^\s*(?:transactions?|expenses?|purchases?)\b/i.test(after)) continue;
    if (value >= 1900 && value <= 2100 && /\b(?:year|expenses?|transactions?|statement|report)\b/i.test(after + before)) {
      continue;
    }

    let score = 0;
    if (/\b(?:spent|paid|bought|purchased|cost|for|@)\s*$/i.test(before)) score += 3;
    else if (/\b(?:spent|paid|bought|purchased|cost)\b/i.test(before)) score += 2;
    if (/^\s*(?:on|for|at|to)\b/i.test(after)) score += 1;
    if (/\b(?:last|next|first|top)\s*$/i.test(before)) score -= 3;

    candidates.push({ value, score, index: match.index });
  }

  if (candidates.length === 0) return { amount: null };
  const maxScore = Math.max(...candidates.map((c) => c.score));
  const best = candidates.filter((c) => c.score === maxScore);
  const values = [...new Set(best.map((c) => c.value))];
  if (values.length === 1) return { amount: values[0] };
  if (values.length > 1) return { ambiguous: true };
  return { amount: null };
}

function extractTitle(text, categoryName) {
  let title = text
    .replace(/(?:₹|rs\.?|inr)\s*\d[\d,]*(?:\.\d{1,2})?/gi, ' ')
    .replace(/\b\d[\d,]*(?:\.\d{1,2})?\s*(?:₹|rs\.?|rupees?|inr)\b/gi, ' ')
    .replace(/\b(?:i|we)\s+/gi, ' ')
    .replace(/\b(?:spent|paid|bought|purchased|cost me|put|charged|swiped|add|log|record|create|save)\b/gi, ' ')
    .replace(/\b(?:an?|the)\s+(?:expense|purchase|transaction)\b/gi, ' ')
    .replace(/\b(?:via|using|with|on|by)\s+(?:my\s+)?(?:upi|cash|credit\s+card|debit\s+card|card|net\s+banking)\b/gi, ' ')
    .replace(/\b(?:today|yesterday|day before yesterday)\b/gi, ' ')
    .replace(/\b(?:on\s+)?\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/gi, ' ')
    .replace(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?\b/gi, ' ')
    .replace(/\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/g, ' ')
    .replace(/\b\d[\d,]*(?:\.\d{1,2})?\b/g, ' ')
    .replace(/\b(?:expense|expenses|purchase|transaction)\b/gi, ' ')
    .replace(/[.,;:!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const merchant = title.match(/\b(?:on|for|at|to)\s+([\p{L}\p{N} &/'_-]{2,60})$/iu);
  if (merchant) title = merchant[1].trim();

  title = title
    .replace(/^(?:on|for|at|to|of)\s+/i, '')
    .replace(/\s+(?:on|for|at|to|of)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!title || title.length < 2) {
    return categoryName === 'Others' ? 'Payment' : `${categoryName} expense`;
  }

  return title.charAt(0).toUpperCase() + title.slice(1, 60);
}

function extractCount(text) {
  const match = text.match(/\b(\d{1,2})\s+(?:tiffins?|meals?)\b/i);
  if (match) return Math.max(1, Math.min(20, Number(match[1])));
  if (/\b(one)\s+(?:tiffin|meal)\b/i.test(text)) return 1;
  if (/\b(two|three|four|five)\s+(?:tiffins?|meals?)\b/i.test(text)) {
    return { one: 1, two: 2, three: 3, four: 4, five: 5 }[
      text.match(/\b(two|three|four|five)\b/i)[1].toLowerCase()
    ];
  }
  return 1;
}

function extractTiffinGroup(text) {
  const match = text.match(/\b(?:in|on|for|to)\s+(?:the\s+)?(?:group\s+)?([a-zA-Z0-9\s_-]+?)(?:\s+(?:between|among|split|with|across|for|all\s+members)\b|$)/i);
  if (!match) return null;
  let name = match[1].trim();
  name = name.replace(/^(?:the\s+|group\s+|tiffin\s+)+/i, '').replace(/\s+(?:group|tiffin)$/i, '').trim();
  if (/^(?:today|yesterday|tomorrow|lunch|dinner|breakfast|all\s+members)$/i.test(name)) return null;
  return name.length > 0 ? name : null;
}

function parseDeterministicIntent(message) {
  const text = cleanText(message);
  const lower = text.toLowerCase();

  // 1. Navigation is only chosen for explicit screen requests, never for a
  // question that asks for financial data or filters spending by category.
  const asksAboutCategory = extractCategory(lower) !== 'Others' && /\b(expenses?|spending|spent|transactions?)\b/i.test(lower);
  const isTopCategoryQuestion = /\b(eating|top category|biggest category|which category|where did (?:most of )?my money|most of my (?:budget|money)|most spending)\b/i.test(lower);
  const hasExplicitPeriod = /\b(?:19|20)\d{2}\b|\b(?:this|last)\s+(?:month|week)\b|\b(?:today|yesterday)\b|\blast\s+\d+\s+days\b/i.test(lower);
  const isTiffinLogOrQuery = !NAV_VERB.test(lower) && /\b(tiffin\s+(?:log|spending|summary|history|expenses?|balance)|calculate\s+tiffin|how\s+(?:much|many)\s+.*tiffin|owe.*tiffin)\b/i.test(lower);
  const isSplitBalanceOrQuery = !NAV_VERB.test(lower) && /\b(split\s+balances?|who\s+owes|group\s+dues?|paid\s+(?:me\s+)?back)\b/i.test(lower);
  const nav = !STRONG_QUERY.test(lower) && !asksAboutCategory && !isTopCategoryQuestion && !hasExplicitPeriod && !isTiffinLogOrQuery && !isSplitBalanceOrQuery ? resolveNavigation(lower) : null;
  if (nav && (NAV_VERB.test(lower) || /^[\w\s&]+$/.test(lower))) {
    return {
      toolName: 'navigate_app',
      params: { screenTarget: nav.screenId, reason: `Open ${nav.title}` },
      isInferred: false,
    };
  }

  // 2. Undo / update / delete
  if (/\b(undo|revert|cancel last|remove last)\b/i.test(lower)) {
    return { toolName: 'undo_last_expense', params: {}, isInferred: false };
  }

  if (/\b(delete|remove)\b/i.test(lower) && /\b(expense|transaction|payment)\b/i.test(lower)) {
    const target = /\b(last|latest|most recent)\b/i.test(lower)
      ? 'last expense'
      : text.replace(/\b(delete|remove)\b/gi, '').replace(/\b(expense|transaction|payment)\b/gi, '').replace(/\b(the|my)\b/gi, '').trim() || 'last expense';
    return { toolName: 'delete_expense', params: { targetQuery: target }, isInferred: false };
  }

  if (/\b(change|update|edit|modify)\b/i.test(lower) && /\b(expense|transaction|payment|last)\b/i.test(lower)) {
    const updates = {};
    const amountInfo = extractAmount(text);
    if (amountInfo.amount) updates.amount = amountInfo.amount;
    const category = extractCategory(lower);
    if (category !== 'Others') updates.category = category;
    const dateInfo = normalizeExplicitDate(lower);
    if (dateInfo.explicit) updates.date = dateInfo.date;
    const target = /\b(last|latest|most recent)\b/i.test(lower)
      ? 'last expense'
      : text.replace(/\b(change|update|edit|modify)\b/gi, '').replace(/\b(amount|category|date|payment method|to|the|my|expense|transaction)\b/gi, '').trim() || 'last expense';
    if (Object.keys(updates).length === 0) {
      return {
        toolName: 'request_clarification',
        params: {
          question: 'What should I change — the amount, category, payment method, or date?',
          options: ['Amount', 'Category', 'Payment method', 'Date'],
          missingField: 'updates',
        },
        isInferred: false,
      };
    }
    return { toolName: 'update_expense', params: { targetQuery: target, updates }, isInferred: false };
  }

  // 3. Top-category questions phrased around "eating my budget".
  if (isTopCategoryQuestion) {
    return {
      toolName: 'query_expenses',
      params: { month: toMonthKey(new Date()), focus: 'top_category' },
      isInferred: true,
    };
  }

  // 4. Budget questions
  if (/\b(budget|remaining|left to spend|over budget|under budget|money left|balance)\b/i.test(lower)
    && !/\b(split|splits|owe[sd]?|settle|settlement|tiffin|tiffins|meal|meals)\b/i.test(lower)) {
    return {
      toolName: 'query_budget',
      params: compactObject({
        month: /\blast month\b/i.test(lower) ? extractPeriod(lower).month : undefined,
        category: extractCategory(lower) !== 'Others' ? extractCategory(lower) : undefined,
      }),
      isInferred: false,
    };
  }

  // 5. Month-over-month comparison
  if (/\b(compare|comparison|vs\.?|versus|than last(?: month)?|more than last(?: month)?|less than last(?: month)?|with last month|to last month|and last month)\b/i.test(lower)
    && /\b(spend|spent|spending|expense|expenses)\b/i.test(lower)) {
    return {
      toolName: 'query_expenses',
      params: { month: toMonthKey(new Date()), comparePreviousMonth: true },
      isInferred: false,
    };
  }

  // 5. Tiffin
  const amountInfoForTiffin = extractAmount(text);
  const isTiffinMeal =
    (!amountInfoForTiffin.amount && (
      /\b(tiffin|tiffins|mess)\b/i.test(lower) ||
      /\b(lunch|lunches|dinner|dinners)\s+(?:logged|taken|had|consumed)\b/i.test(lower) ||
      /\b(?:log|record|add|had|ate|took)\s+(?:a\s+|my\s+|today'?s\s+|yesterday'?s\s+)?(?:lunch|dinner|breakfast)\b/i.test(lower)
    )) || /\b(tiffin|tiffins)\b/i.test(lower);
  if (isTiffinMeal) {
    if (
      /\b(how many|how much|total|summary|bill|status|count|check|calculate|spending|cost|spent|balance|history|expenses?|owe|owed)\b/i.test(lower) ||
      /\bshow\s+(?:my\s+)?tiffin\b/i.test(lower) ||
      /\btiffin\s+log\b/i.test(lower)
    ) {
      const period = extractPeriod(lower);
      return {
        toolName: 'query_tiffin',
        params: compactObject({
          month: period.month,
          date: period.startDate || undefined,
        }),
        isInferred: true,
      };
    }
    let mealType = 'lunch';
    if (/\bdinner\b/i.test(lower)) mealType = 'dinner';
    else if (/\bbreakfast\b/i.test(lower)) mealType = 'breakfast';
    const dateInfo = normalizeExplicitDate(lower);
    const groupName = extractTiffinGroup(text);
    const splitBetweenAll = /\b(?:between|among|across|split(?:\s+between)?)\s+(?:all\s+)?(?:the\s+)?members\b/i.test(lower);
    return {
      toolName: 'log_tiffin',
      params: compactObject({
        mealType,
        date: dateInfo.date,
        count: extractCount(lower),
        groupName: groupName || undefined,
        splitBetweenAll: splitBetweenAll || undefined,
      }),
      isInferred: !dateInfo.explicit,
    };
  }

  // 6. Split queries and creations
  if (/\b(split|splits|owe[sd]?|settle|settlement|shared bill|roommate|group dues?|dues|paid (?:me )?back|pay back)\b/i.test(lower)) {
    const amountInfo = extractAmount(text);
    const isSplitQuery = /\b(who owes|how much|check|summary|balances?|dues?|debts?|who has not)\b/i.test(lower);
    if (amountInfo.amount && !isSplitQuery && (/\b(split|create|add|log|bill|spent|paid)\b/i.test(lower) || /\bsplit\s+\d+/i.test(lower))) {
      return {
        toolName: 'create_split',
        params: {
          amount: amountInfo.amount,
          description: extractTitle(text, 'Others'),
        },
        isInferred: false,
      };
    }
    return { toolName: 'query_splits', params: {}, isInferred: false };
  }

  // 7. Spending questions. Checked before expense creation so phrases such as
  // "how much did I spend" or "show my 2025 expenses" never become expenses.
  const asksForSpending =
    STRONG_QUERY.test(lower) ||
    /\b(spending|expenses|transactions|purchases)\b/i.test(lower) ||
    /\bwhere did (?:most of )?my money go\b/i.test(lower);
  const strongDataQuestion =
    /\b(how much|how many|what did i|what have i|what'?s my|what is my|total|summary|breakdown|top category|biggest|largest|highest|where did|compare|recent|remaining|budget)\b/i.test(lower);

  if (asksForSpending && (strongDataQuestion || !CREATE_EXPENSE.test(lower) || /\b(show|list|view)\b/i.test(lower))) {
    const period = extractPeriod(lower);
    const category = extractCategory(lower);
    const isRecentList = /\b(recent|latest|last few|last \d+ (?:transactions?|expenses?|purchases?))\b/i.test(lower)
      && !/\b(today|yesterday|last month|this month|last week|this week|last \d+ days)\b/i.test(lower);
    const params = compactObject({
      category: category !== 'Others' ? category : undefined,
      month: isRecentList ? undefined : period.month,
      startDate: isRecentList ? undefined : period.startDate,
      endDate: isRecentList ? undefined : period.endDate,
      limit: extractLimit(text),
    });
    if (/\b(biggest|largest|highest)\b/i.test(lower)) params.focus = 'largest_expense';
    else if (/\b(top category|where did|which category|most of my money|most spending)\b/i.test(lower)) params.focus = 'top_category';
    return { toolName: 'query_expenses', params, isInferred: true };
  }

  // 8. Expense creation
  const category = extractCategory(lower);
  const amountInfo = extractAmount(text);
  const hasCategoryWithAmount = category !== 'Others' && (amountInfo.amount || amountInfo.ambiguous) && !asksForSpending;
  const hasCategoryWithVerb = category !== 'Others' && !asksForSpending && /\b(done|bought|paid|spent|added|charged|recharge|transaction|got)\b/i.test(lower);
  const isExpenseCreation =
    CREATE_EXPENSE.test(lower) ||
    /\b(expense|expenses|purchase|transaction)\b/i.test(lower) ||
    hasCategoryWithAmount ||
    hasCategoryWithVerb;

  if (isExpenseCreation) {
    const dateInfo = normalizeExplicitDate(lower);
    const draftParams = compactObject({
      category: category !== 'Others' ? category : undefined,
      paymentMethod: extractPaymentMethod(lower),
      date: dateInfo.date,
      isExplicitDate: dateInfo.explicit,
      title: extractTitle(text, category),
    });

    if (amountInfo.ambiguous) {
      return {
        toolName: 'request_clarification',
        params: {
          question: 'I see more than one possible amount. What exact amount did you spend in rupees?',
          options: [],
          missingField: 'amount',
        },
        pendingAction: { toolName: 'create_expense', params: draftParams },
        isInferred: false,
      };
    }
    if (!amountInfo.amount) {
      return {
        toolName: 'request_clarification',
        params: {
          question: 'How much did you spend in rupees?',
          options: ['₹100', '₹250', '₹500', '₹1000'],
          missingField: 'amount',
        },
        pendingAction: { toolName: 'create_expense', params: draftParams },
        isInferred: false,
      };
    }

    return {
      toolName: 'create_expense',
      params: {
        amount: amountInfo.amount,
        category,
        paymentMethod: extractPaymentMethod(lower),
        date: dateInfo.date,
        isExplicitDate: dateInfo.explicit,
        title: extractTitle(text, category),
      },
      isInferred: !dateInfo.explicit,
    };
  }

  // 9. Helpful, grounded fallback. Never invents financial numbers.
  return {
    toolName: 'general_answer',
    params: {
      response:
        'I can log expenses, check spending and budgets, review split balances, log tiffin meals, or open any app screen. Try “Spent ₹250 on lunch yesterday” or “How much did I spend this month?”',
    },
    isInferred: false,
  };
}

module.exports = {
  parseDeterministicIntent,
  extractAmount,
  extractCategory,
  extractPeriod,
  extractTitle,
  normalizeExplicitDate,
  compactObject,
};
