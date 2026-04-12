const fs = require('fs');
const path = require('path');

function normalizeCandidates(candidates) {
  return candidates.filter((candidate) => typeof candidate === 'string' && candidate.length > 0);
}

function stripWrappedQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function loadOptionalEnvFile(projectRoot, options = {}) {
  const { logPrefix = 'Scripts', env = process.env } = options;
  const envPath = path.join(projectRoot, '.env');

  if (!fs.existsSync(envPath)) {
    return undefined;
  }

  try {
    const envContent = fs.readFileSync(envPath, 'utf8');
    for (const rawLine of envContent.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) {
        continue;
      }

      const separatorIndex = line.indexOf('=');
      if (separatorIndex === -1) {
        continue;
      }

      const key = line.slice(0, separatorIndex).trim();
      if (!key || env[key]) {
        continue;
      }

      const rawValue = line.slice(separatorIndex + 1).trim();
      env[key] = stripWrappedQuotes(rawValue);
    }

    console.log(`[${logPrefix}] Loaded configuration from ${envPath}`);
    return envPath;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[${logPrefix}] Failed to parse .env file: ${message}`);
    return undefined;
  }
}

function resolveFirstExistingPath(projectRoot, candidates) {
  for (const candidate of normalizeCandidates(candidates)) {
    const resolved = path.resolve(projectRoot, candidate);
    if (fs.existsSync(resolved)) {
      return resolved;
    }
  }

  return undefined;
}

function resolveExistingPath(projectRoot, label, candidates) {
  const normalizedCandidates = normalizeCandidates(candidates);
  const resolved = resolveFirstExistingPath(projectRoot, normalizedCandidates);

  if (resolved) {
    return resolved;
  }

  throw new Error(`Could not resolve ${label}. Tried: ${normalizedCandidates.join(', ')}`);
}

function getMmDataRootCandidates(options = {}) {
  const { override = process.env.MM_DATA_PATH, includeMegaMekData = false } = options;

  return [
    override || '',
    ...(includeMegaMekData ? ['../megamek/megamek', '../../megamek/megamek'] : []),
    '../mm-data',
    '../../mm-data',
  ];
}

function resolveMmDataRoot(projectRoot, options = {}) {
  const { allowMissing = false, label = 'MM_DATA_PATH' } = options;
  const candidates = getMmDataRootCandidates(options);

  if (allowMissing) {
    return resolveFirstExistingPath(projectRoot, candidates) || path.resolve(projectRoot, normalizeCandidates(candidates)[0]);
  }

  return resolveExistingPath(projectRoot, label, candidates);
}

module.exports = {
  loadOptionalEnvFile,
  resolveExistingPath,
  resolveMmDataRoot,
};