import { extname, resolve } from 'node:path';
import { ask } from './ask.js';

/**
 * @typedef {object} ResolveSavePathSuccess
 * @property {true} ok
 * @property {string} path
 */

/**
 * @typedef {object} ResolveSavePathFailure
 * @property {false} ok
 * @property {string} reason
 */

/**
 * @param {string} value
 * @returns {string}
 */
function stripWrappingQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Resolve a user-supplied path for writing an .xlsx file.
 * The parent directory does not need to exist yet.
 *
 * @param {string} input
 * @param {object} [options]
 * @param {string} [options.defaultPath] Used when `input` is blank.
 * @param {string} [options.cwd]
 * @returns {ResolveSavePathSuccess | ResolveSavePathFailure}
 */
export function resolveSavePath(input, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const trimmed = stripWrappingQuotes(String(input ?? '').trim());
  const candidate = trimmed === '' ? options.defaultPath : trimmed;

  if (candidate == null || String(candidate).trim() === '') {
    return { ok: false, reason: 'A path is required.' };
  }

  let absolutePath = resolve(cwd, stripWrappingQuotes(String(candidate).trim()));
  const extension = extname(absolutePath).toLowerCase();

  if (extension === '') {
    absolutePath = `${absolutePath}.xlsx`;
  } else if (extension !== '.xlsx') {
    return {
      ok: false,
      reason: `Unsupported file type "${extname(absolutePath)}". Expected .xlsx.`,
    };
  }

  return { ok: true, path: absolutePath };
}

/**
 * @param {object} [options]
 * @param {string} [options.defaultPath]
 * @param {string} [options.message]
 * @returns {string}
 */
function buildPrompt(options = {}) {
  const message = options.message ?? 'Enter an Excel (.xlsx) output path';
  if (options.defaultPath) {
    return `${message}\nPress Enter for default (${options.defaultPath}): `;
  }
  return `${message}: `;
}

/**
 * Prompt until the user provides a valid .xlsx save path.
 *
 * @param {object} [options]
 * @param {string} [options.defaultPath]
 * @param {string} [options.message]
 * @param {string} [options.cwd]
 * @param {(prompt: string) => Promise<string>} [options.question]
 * @param {(message?: string) => void} [options.log]
 * @returns {Promise<string>} Absolute path
 */
export async function promptForSavePath(options = {}) {
  const log = options.log ?? console.log;
  const questionOptions = options.question ? { question: options.question } : {};

  for (;;) {
    const answer = await ask(buildPrompt(options), questionOptions);
    const result = resolveSavePath(answer, {
      defaultPath: options.defaultPath,
      cwd: options.cwd,
    });

    if (result.ok) {
      return result.path;
    }

    log(result.reason);
    await ask('Press Enter to try again (or Ctrl+C to cancel)', questionOptions);
  }
}
