/**
 * Stateless conversational follow-up merger.
 *
 * The mobile client echoes the last pendingAction when the next message is an
 * answer to a clarification (for example, the category chips on an expense
 * card). This module only fills safe, typed fields on an already validated
 * create_expense action. It never trusts arbitrary client parameters and never
 * treats a new command as a clarification answer.
 */

const PAYMENT_METHODS = ['UPI', 'Cash', 'Credit Card', 'Debit Card', 'Net Banking'];

const NEW_INTENT_PATTERN =
  /\b(?:open|navigate|show|go to|take me|how much|what did i spend|total|budget|report|analytics|split|tiffin|undo|delete|remove|change|update|edit|add expense|log expense|record expense|spent|paid|bought|purchase)\b/i;

function clean(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function parseAmountAnswer(message) {
  const match = clean(message).match(
    /^(?:₹|rs\.?|inr)?\s*(\d{1,7}(?:,\d{3})*(?:\.\d{1,2})?)\s*(?:₹|rs\.?|rupees?|inr)?$/i
  );
  if (!match) return null;
  const amount = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function parsePaymentAnswer(message) {
  const text = clean(message);
  const direct = PAYMENT_METHODS.find((method) => method.toLowerCase() === text.toLowerCase());
  if (direct) return direct;

  const prefixed = text.match(/^(?:by|via|using|with)\s+(.+)$/i);
  if (!prefixed) return null;
  const value = prefixed[1].trim().toLowerCase();
  return (
    PAYMENT_METHODS.find((method) => method.toLowerCase() === value) ||
    (value === 'card' ? 'Credit Card' : null)
  );
}

function parseDateAnswer(message) {
  const text = clean(message).toLowerCase();
  if (/^(today|yesterday|day before yesterday)$/.test(text)) return text;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (/^\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?$/.test(text)) return text;
  return null;
}

/**
 * @returns {{ action: { toolName: string, params: object }, field: string } | null}
 */
function mergePendingAction(pendingAction, message) {
  if (!pendingAction || pendingAction.toolName !== 'create_expense') return null;
  const params = pendingAction.params;
  if (!params || typeof params !== 'object') return null;

  const text = clean(message);
  if (!text || text.length > 80 || NEW_INTENT_PATTERN.test(text)) return null;

  // Whitelist only registered tool parameters. The client may echo a display
  // object that also contains categoryId/saved/isComplete, which must never
  // reach the tool schema validator.
  const merged = {};
  for (const key of ['amount', 'category', 'title', 'paymentMethod', 'date', 'notes', 'isExplicitDate']) {
    if (params[key] !== undefined) merged[key] = params[key];
  }

  const amount = parseAmountAnswer(text);
  if (amount !== null) {
    return {
      action: { toolName: 'create_expense', params: { ...merged, amount } },
      field: 'amount',
    };
  }

  const paymentMethod = parsePaymentAnswer(text);
  if (paymentMethod) {
    return {
      action: { toolName: 'create_expense', params: { ...merged, paymentMethod } },
      field: 'paymentMethod',
    };
  }

  const date = parseDateAnswer(text);
  if (date) {
    return {
      action: { toolName: 'create_expense', params: { ...merged, date } },
      field: 'date',
    };
  }

  // A short free-text answer after a category question is the category phrase.
  // The tool executor resolves it against the authenticated user's real
  // categories, so no category ID is ever invented on the client.
  if (text.length <= 60 && /^[\p{L}\p{N} &/'._-]+$/u.test(text)) {
    return {
      action: { toolName: 'create_expense', params: { ...merged, category: text } },
      field: 'category',
    };
  }

  return null;
}

module.exports = { mergePendingAction, parseAmountAnswer, parsePaymentAnswer, parseDateAnswer };
