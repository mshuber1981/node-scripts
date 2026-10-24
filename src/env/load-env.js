import { readFileSync } from 'node:fs';

/**
 * Load KEY=VALUE pairs from a .env file into `env` when the key is unset.
 * Does not override existing environment variables.
 *
 * @param {string} filePath
 * @param {object} [options]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {(path: string, encoding: 'utf8') => string} [options.readFileSync]
 * @returns {void}
 */
export function loadEnvFile(filePath, options = {}) {
  const env = options.env ?? process.env;
  const readFile = options.readFileSync ?? readFileSync;

  let content;
  try {
    content = readFile(filePath, 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return;
    }
    throw error;
  }

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }

    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed);
    if (!match) {
      continue;
    }

    const key = match[1];
    if (env[key] !== undefined) {
      continue;
    }

    let value = match[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
}
