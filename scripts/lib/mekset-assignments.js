const fs = require('fs');
const path = require('path');

function normalizeMeksetKey(value) {
  return value.toUpperCase();
}

function tokenizeMeksetLine(line) {
  const tokens = [];
  // MegaMek's StreamTokenizer accepts several legacy lines whose final quoted
  // image path is missing its closing quote, so preserve that behavior.
  const pattern = /"([^"]*)(?:"|$)|(\S+)/g;
  let match;

  while ((match = pattern.exec(line)) !== null) {
    tokens.push(match[1] ?? match[2]);
  }

  return tokens;
}

function loadMeksetAssignments(filePath, options = {}) {
  const { availableIcons } = options;
  const exact = new Map();
  const chassis = new Map();
  const missingIcons = new Set();
  const activeIncludes = new Set();

  function load(currentPath) {
    const resolvedPath = path.resolve(currentPath);
    if (activeIncludes.has(resolvedPath)) {
      throw new Error(`Circular mekset include: ${resolvedPath}`);
    }
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Mekset file not found: ${resolvedPath}`);
    }

    activeIncludes.add(resolvedPath);
    try {
      const lines = fs.readFileSync(resolvedPath, 'utf8').split(/\r?\n/);
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;

        const tokens = tokenizeMeksetLine(line);
        const directive = tokens[0]?.toLowerCase();
        if (directive === 'include' && tokens.length >= 2) {
          load(path.resolve(path.dirname(resolvedPath), tokens[1]));
          continue;
        }
        if ((directive !== 'exact' && directive !== 'chassis') || tokens.length < 3) {
          continue;
        }

        const iconPath = tokens[2].replaceAll('\\', '/');
        if (availableIcons && !availableIcons.has(iconPath.toLowerCase())) {
          missingIcons.add(iconPath);
          continue;
        }

        const target = directive === 'exact' ? exact : chassis;
        target.set(normalizeMeksetKey(tokens[1]), iconPath);
      }
    } finally {
      activeIncludes.delete(resolvedPath);
    }
  }

  load(filePath);

  return {
    exact: Object.fromEntries(exact),
    chassis: Object.fromEntries(chassis),
    missingIcons: [...missingIcons].sort(),
  };
}

module.exports = {
  loadMeksetAssignments,
  normalizeMeksetKey,
  tokenizeMeksetLine,
};
