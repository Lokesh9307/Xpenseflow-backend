const { validateRegisteredToolCall } = require('./toolRegistry');
const { isMutation } = require('./policyEngine');

const MAX_PLAN_ACTIONS = 5;

function planActions(actions, rawMessage) {
  if (!Array.isArray(actions) || actions.length === 0) {
    return { valid: false, reason: 'No actions were proposed.' };
  }
  if (actions.length > MAX_PLAN_ACTIONS) {
    return { valid: false, reason: `A request may contain at most ${MAX_PLAN_ACTIONS} actions.` };
  }

  const cleanActions = [];
  for (const action of actions) {
    if (!action || !validateRegisteredToolCall(action.toolName, action.params)) {
      return { valid: false, reason: 'The proposed action failed registered-tool validation.' };
    }
    cleanActions.push({
      toolName: action.toolName,
      params: action.params,
      mutation: isMutation(action.toolName),
      sourceText: String(rawMessage || ''),
    });
  }

  return { valid: true, actions: cleanActions };
}

module.exports = { planActions, MAX_PLAN_ACTIONS };
