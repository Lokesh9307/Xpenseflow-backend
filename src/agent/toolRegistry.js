const { AGENT_TOOLS } = require('./toolDefinitions');

const toolMap = new Map(
  AGENT_TOOLS.map((tool) => [tool.function.name, tool.function])
);

function listRegisteredTools() {
  return [...toolMap.keys()];
}

function getRegisteredTool(name) {
  return toolMap.get(name) || null;
}

function valueMatchesType(value, type) {
  if (type === 'string') return typeof value === 'string';
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return !!value && typeof value === 'object' && !Array.isArray(value);
  return false;
}

function validateAgainstSchema(value, schema) {
  if (!valueMatchesType(value, schema.type)) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;

  if (schema.type === 'array') {
    return !schema.items || value.every((item) => validateAgainstSchema(item, schema.items));
  }

  if (schema.type === 'object') {
    const properties = schema.properties || {};
    if (Object.keys(value).some((key) => !Object.prototype.hasOwnProperty.call(properties, key))) {
      return false;
    }
    if ((schema.required || []).some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
      return false;
    }
    return Object.entries(value).every(([key, item]) =>
      validateAgainstSchema(item, properties[key])
    );
  }

  return true;
}

function validateRegisteredToolCall(toolName, params) {
  const tool = getRegisteredTool(toolName);
  if (!tool || !validateAgainstSchema(params, tool.parameters)) return false;
  if (toolName === 'create_expense' || toolName === 'create_split') {
    return params.amount > 0;
  }
  if (toolName === 'update_expense' && params.updates.amount !== undefined) {
    return params.updates.amount > 0;
  }
  if (toolName === 'log_tiffin' && params.count !== undefined) {
    return Number.isInteger(params.count) && params.count > 0;
  }
  if (toolName === 'navigate_app') {
    return params.screenTarget.trim().length > 0;
  }
  if (toolName === 'request_clarification') {
    return params.question.trim().length > 0 &&
      params.options.every((option) => option.trim().length > 0);
  }
  if (toolName === 'general_answer') {
    return params.response.trim().length > 0;
  }
  return true;
}

module.exports = {
  getRegisteredTool,
  listRegisteredTools,
  validateRegisteredToolCall,
};
