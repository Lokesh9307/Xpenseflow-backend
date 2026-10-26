const Category = require('../models/Category');
const { getNavigableScreensList } = require('./navigationRegistry');

async function resolveAgentContext(userId, skillIds) {
  if (!userId) throw new Error('Authenticated user context is required');
  const context = {
    today: new Date().toISOString().slice(0, 10),
  };

  if (skillIds.includes('expense-management')) {
    const categories = await Category.find({ userId }).select('name').lean();
    context.categories = categories.map((category) => category.name);
  }
  if (skillIds.includes('app-navigation')) {
    context.navigation = getNavigableScreensList().map(({ screenId, title }) => ({
      screenId,
      title,
    }));
  }
  return context;
}

module.exports = { resolveAgentContext };
