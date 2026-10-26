const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadSkills, validateSkillFrontmatter } = require('../agent/skillLoader');
const { routeSkills } = require('../agent/skillRouter');
const { planActions } = require('../agent/actionPlanner');
const { authorizeAction } = require('../agent/policyEngine');
const { validateRegisteredToolCall } = require('../agent/toolRegistry');

describe('Skill-driven agent workflow', () => {
  it('loads core and relevant domain skills with their allowlisted references', () => {
    const skillIds = routeSkills('Check my tiffin expense this month');
    const skills = loadSkills(skillIds);

    assert.ok(skillIds.includes('xpenseflow-core'));
    assert.ok(skillIds.includes('expense-management'));
    assert.ok(skillIds.includes('financial-insights'));
    assert.ok(skillIds.includes('tiffin-management'));
    assert.ok(skills.every((skill) => skill.content.length > 0));
    assert.ok(skills.find((skill) => skill.id === 'tiffin-management').references.length > 0);
  });

  it('rejects skills without the core skill and mismatched frontmatter names', () => {
    assert.throws(() => loadSkills(['expense-management']), /must load xpenseflow-core/);
    assert.throws(
      () => validateSkillFrontmatter(
        'expense-management',
        '---\nname: tiffin-management\ndescription: test\n---\nBody'
      ),
      /invalid name or description/
    );
  });

  it('preserves dependency order and rejects invalid registered-tool arguments', () => {
    const actions = [
      { toolName: 'query_expenses', params: { month: 'this month' } },
      { toolName: 'create_expense', params: { amount: 400, category: 'Food & Dining' } },
    ];
    const plan = planActions(actions, 'Check spending, then add an expense');

    assert.equal(plan.valid, true);
    assert.deepEqual(plan.actions.map((action) => action.toolName), ['query_expenses', 'create_expense']);
    assert.equal(validateRegisteredToolCall('create_expense', { amount: 0 }), false);
    assert.equal(validateRegisteredToolCall('create_expense', { amount: 400, unexpected: true }), false);
  });

  it('blocks financial mutations when the request is negated or hypothetical', () => {
    const action = {
      toolName: 'create_expense',
      params: { amount: 400, category: 'Food & Dining' },
    };

    assert.equal(
      authorizeAction(action, { userId: 'user-1', rawMessage: "Don't add this expense" }).allowed,
      false
    );
    assert.equal(
      authorizeAction(action, { userId: 'user-1', rawMessage: 'What if I spent ₹400 on lunch?' }).allowed,
      false
    );
    assert.equal(
      authorizeAction(action, { userId: 'user-1', rawMessage: 'I spent ₹400 on lunch' }).allowed,
      true
    );
  });
});
