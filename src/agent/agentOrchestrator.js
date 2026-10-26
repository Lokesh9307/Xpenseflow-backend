const { routeSkills } = require('./skillRouter');
const { loadSkills } = require('./skillLoader');
const { resolveAgentContext } = require('./contextResolver');
const { resolveIntent } = require('./intentResolver');
const { planActions } = require('./actionPlanner');
const { authorizeAction } = require('./policyEngine');
const { executeTool } = require('./toolExecutor');
const { verifyToolResult } = require('./resultVerifier');

function formatSkillInstructions(skills) {
  return skills
    .map((skill) => [
      `## Loaded skill: ${skill.id}`,
      skill.content,
      ...skill.references.map((reference) => `### ${reference.path}\n${reference.content}`),
    ].join('\n\n'))
    .join('\n\n');
}

async function prepareAgentRequest({ userId, message, history = [], mode = 'agentic' }) {
  const skillIds = routeSkills(message);
  const skills = loadSkills(skillIds);
  const trustedContext = await resolveAgentContext(userId, skillIds);
  const resolution = await resolveIntent(message, history, {
    mode,
    skillInstructions: formatSkillInstructions(skills),
    trustedContext,
  });
  const actions = resolution.actions || [{
    toolName: resolution.toolName,
    params: resolution.params,
  }];
  const plan = planActions(actions, message);

  return {
    skillIds,
    trustedContext,
    resolution,
    plan,
  };
}

async function executeAgentPlan(plan, context) {
  const results = [];
  for (let index = 0; index < plan.actions.length; index += 1) {
    const action = plan.actions[index];
    const authorization = authorizeAction(action, context);
    if (!authorization.allowed) {
      return {
        success: false,
        stopped: true,
        reason: authorization.reason,
        results,
      };
    }

    const actionContext = {
      ...context,
      requestId: plan.actions.length === 1
        ? context.requestId
        : `${context.requestId}:step:${index + 1}`,
    };
    const outcome = await executeTool(action.toolName, action.params, actionContext);
    if (outcome.success !== true || outcome.intent === 'clarification.required') {
      results.push({ toolName: action.toolName, outcome });
      return { success: false, stopped: true, results };
    }

    const verification = await verifyToolResult(action.toolName, outcome, context.userId);
    if (!verification.verified) {
      results.push({
        toolName: action.toolName,
        outcome: {
          success: false,
          message: verification.reason || 'The action could not be verified.',
        },
      });
      return { success: false, stopped: true, results };
    }

    results.push({
      toolName: action.toolName,
      outcome: { ...outcome, verifiedData: verification.verifiedData },
    });
  }
  return { success: true, stopped: false, results };
}

module.exports = { prepareAgentRequest, executeAgentPlan };
