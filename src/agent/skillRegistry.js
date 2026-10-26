const SKILLS = Object.freeze({
  'xpenseflow-core': {
    references: [],
  },
  'expense-management': {
    references: ['references/category-resolution.md'],
  },
  'financial-insights': {
    references: ['references/query-rules.md'],
  },
  'split-expenses': {
    references: ['references/split-rules.md'],
  },
  'tiffin-management': {
    references: ['references/tiffin-rules.md'],
  },
  'app-navigation': {
    references: ['references/navigation-registry.md'],
  },
  'general-app-help': {
    references: [],
  },
});

function listSkillIds() {
  return Object.keys(SKILLS);
}

function getSkillConfig(skillId) {
  return SKILLS[skillId] || null;
}

module.exports = { listSkillIds, getSkillConfig };
