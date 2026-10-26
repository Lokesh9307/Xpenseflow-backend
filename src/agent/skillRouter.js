const { getSkillConfig } = require('./skillRegistry');

const SKILL_PATTERNS = [
  ['expense-management', /\b(expense|expenses|spent|spend|purchase|bought|merchant|transaction|category|petrol|fuel|groceries|receipt|delete|undo|edit)\b/i],
  ['financial-insights', /\b(how much|total|compare|comparison|trend|budget|remaining|spending|analytics|report|income|month|monthly|last month|this month)\b/i],
  ['split-expenses', /\b(split|owe|owed|settle|settlement|shared bill|roommate)\b/i],
  ['tiffin-management', /\b(tiffin|meal|breakfast|lunch|dinner|mess|tiffin tracker)\b/i],
  ['app-navigation', /\b(open|show|go to|take me|navigate|where is|where can i|where do i|screen|page)\b/i],
];

function routeSkills(message) {
  const text = String(message || '');
  const skills = ['xpenseflow-core'];
  for (const [skillId, pattern] of SKILL_PATTERNS) {
    if (pattern.test(text) && getSkillConfig(skillId)) skills.push(skillId);
  }
  if (skills.length === 1) skills.push('general-app-help');
  return [...new Set(skills)];
}

module.exports = { routeSkills };
