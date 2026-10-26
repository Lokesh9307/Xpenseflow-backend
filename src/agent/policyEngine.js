const { validateRegisteredToolCall } = require('./toolRegistry');

const MUTATION_TOOLS = new Set([
  'create_expense',
  'update_expense',
  'delete_expense',
  'undo_last_expense',
  'create_split',
  'log_tiffin',
]);

const NEGATED_OR_HYPOTHETICAL_ACTION =
  /\b(?:do not|don't|dont|never|not|without)\b[\s\S]{0,60}\b(?:add|create|record|log|delete|remove|update|change|split|undo)\b|\b(?:what if|if i (?:were to|wanted to)|suppose i)\b/i;

function isMutation(toolName) {
  return MUTATION_TOOLS.has(toolName);
}

function authorizeAction(action, context = {}) {
  if (!action || !validateRegisteredToolCall(action.toolName, action.params)) {
    return { allowed: false, reason: 'The proposed action is not a valid registered tool call.' };
  }
  if (!context.userId) {
    return { allowed: false, reason: 'An authenticated user is required.' };
  }
  if (
    isMutation(action.toolName) &&
    NEGATED_OR_HYPOTHETICAL_ACTION.test(String(context.rawMessage || ''))
  ) {
    return { allowed: false, reason: 'The message does not authorize a financial mutation.' };
  }
  return { allowed: true };
}

module.exports = { authorizeAction, isMutation };
