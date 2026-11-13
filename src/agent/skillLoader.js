const fs = require('node:fs');
const path = require('node:path');
const { getSkillConfig } = require('./skillRegistry');
const bundledSkills = require('./bundledSkills');

function resolveSkillsRoot() {
  const candidates = [
    process.env.SKILLS_DIR,
    path.resolve(__dirname, '../../../skills'),
    path.resolve(__dirname, '../../skills'),
    path.resolve(process.cwd(), 'skills'),
    path.resolve(process.cwd(), '../skills'),
  ].filter(Boolean);

  for (const dir of candidates) {
    try {
      if (fs.existsSync(dir) && fs.existsSync(path.join(dir, 'xpenseflow-core', 'SKILL.md'))) {
        return dir;
      }
    } catch {
      // continue candidate search
    }
  }
  return null;
}

function readSkillDocument(skillId, relativePath) {
  const config = getSkillConfig(skillId);
  if (!config) throw new Error(`Unregistered skill: ${skillId}`);

  const allowedPaths = ['SKILL.md', ...config.references];
  if (!allowedPaths.includes(relativePath)) {
    throw new Error(`Unregistered skill document: ${skillId}/${relativePath}`);
  }

  const normalizedRel = relativePath.replace(/\\/g, '/');
  const bundleKey = `${skillId}/${normalizedRel}`;

  const root = resolveSkillsRoot();
  if (root) {
    try {
      const skillRoot = path.resolve(root, skillId);
      const filePath = path.resolve(skillRoot, relativePath);
      if (filePath.startsWith(`${skillRoot}${path.sep}`) || filePath === skillRoot || filePath.startsWith(skillRoot)) {
        if (fs.existsSync(filePath)) {
          return fs.readFileSync(filePath, 'utf8');
        }
      }
    } catch {
      // fallback to bundled skills below
    }
  }

  if (bundledSkills && Object.prototype.hasOwnProperty.call(bundledSkills, bundleKey)) {
    return bundledSkills[bundleKey];
  }

  throw new Error(`Skill document not found: ${bundleKey}`);
}

function validateSkillFrontmatter(skillId, content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error(`Skill ${skillId} has missing YAML frontmatter`);

  const name = match[1].match(/^name:\s*([a-z0-9-]+)\s*$/m)?.[1];
  const description = match[1].match(/^description:\s*(.+)\s*$/m)?.[1];
  if (name !== skillId || !description) {
    throw new Error(`Skill ${skillId} has invalid name or description frontmatter`);
  }
  return { body: content.slice(match[0].length), description };
}

function loadSkills(skillIds) {
  const uniqueIds = [...new Set(skillIds || [])];
  if (uniqueIds.length === 0 || !uniqueIds.includes('xpenseflow-core')) {
    throw new Error('Every agent request must load xpenseflow-core');
  }

  return uniqueIds.map((skillId) => {
    const main = validateSkillFrontmatter(
      skillId,
      readSkillDocument(skillId, 'SKILL.md')
    );
    const references = getSkillConfig(skillId).references.map((relativePath) => ({
      path: relativePath,
      content: readSkillDocument(skillId, relativePath),
    }));

    return {
      id: skillId,
      description: main.description,
      content: main.body.trim(),
      references,
    };
  });
}

module.exports = { loadSkills, validateSkillFrontmatter };
