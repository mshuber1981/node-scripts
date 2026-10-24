import { existsSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { ask } from './ask.js';

/**
 * @typedef {'csv' | 'xlsx'} TabularFileKind
 */

/**
 * @typedef {object} ResolvedTabularFile
 * @property {string} path Absolute path to the file.
 * @property {TabularFileKind} kind
 */

/**
 * @typedef {object} ResolveTabularFileSuccess
 * @property {true} ok
 * @property {string} path
 * @property {TabularFileKind} kind
 */

/**
 * @typedef {object} ResolveTabularFileFailure
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
 * @param {string} filePath
 * @returns {TabularFileKind | null}
 */
function kindFromPath(filePath) {
  const extension = extname(filePath).toLowerCase();
  if (extension === '.csv') {
    return 'csv';
  }
  if (extension === '.xlsx') {
    return 'xlsx';
  }
  return null;
}

/**
 * @param {string} filePath
 * @returns {boolean}
 */
function hasExtension(filePath) {
  return extname(filePath) !== '';
}

/**
 * Resolve a user-supplied path to an existing CSV or XLSX file.
 * Relative paths are resolved against `cwd` (default `process.cwd()`).
 * Does not open or parse the file.
 *
 * @param {string} input
 * @param {object} [options]
 * @param {string} [options.defaultPath] Used when `input` is blank.
 * @param {string} [options.cwd]
 * @param {(path: string) => boolean} [options.existsSync]
 * @returns {ResolveTabularFileSuccess | ResolveTabularFileFailure}
 */
export function resolveTabularFilePath(input, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const fileExists = options.existsSync ?? existsSync;
  const trimmed = stripWrappingQuotes(String(input ?? '').trim());
  const candidate = trimmed === '' ? options.defaultPath : trimmed;

  if (candidate == null || String(candidate).trim() === '') {
    return { ok: false, reason: 'A path is required.' };
  }

  const absolutePath = resolve(cwd, stripWrappingQuotes(String(candidate).trim()));
  const kind = kindFromPath(absolutePath);

  if (fileExists(absolutePath)) {
    if (!kind) {
      return {
        ok: false,
        reason: `Unsupported file type "${extname(absolutePath) || '(none)'}". Expected .csv or .xlsx.`,
      };
    }
    return { ok: true, path: absolutePath, kind };
  }

  if (!hasExtension(absolutePath)) {
    const withXlsx = `${absolutePath}.xlsx`;
    if (fileExists(withXlsx)) {
      return { ok: true, path: withXlsx, kind: 'xlsx' };
    }
    const withCsv = `${absolutePath}.csv`;
    if (fileExists(withCsv)) {
      return { ok: true, path: withCsv, kind: 'csv' };
    }
    return { ok: false, reason: `File not found: ${absolutePath}` };
  }

  if (!kind) {
    return {
      ok: false,
      reason: `Unsupported file type "${extname(absolutePath)}". Expected .csv or .xlsx.`,
    };
  }

  return { ok: false, reason: `File not found: ${absolutePath}` };
}

/**
 * @param {object} [options]
 * @param {string} [options.defaultPath]
 * @param {string} [options.message]
 * @returns {string}
 */
function buildPrompt(options = {}) {
  const message = options.message ?? 'Enter a CSV or Excel (.xlsx) file path';
  if (options.defaultPath) {
    return `${message}\nPress Enter for default (${options.defaultPath}): `;
  }
  return `${message}: `;
}

/**
 * Prompt until the user provides an existing .csv or .xlsx path.
 *
 * @param {object} [options]
 * @param {string} [options.defaultPath]
 * @param {string} [options.message]
 * @param {string} [options.cwd]
 * @param {(path: string) => boolean} [options.existsSync]
 * @param {(prompt: string) => Promise<string>} [options.question]
 * @param {(message?: string) => void} [options.log]
 * @returns {Promise<ResolvedTabularFile>}
 */
export async function promptForTabularFile(options = {}) {
  const log = options.log ?? console.log;
  const questionOptions = options.question ? { question: options.question } : {};

  for (;;) {
    const answer = await ask(buildPrompt(options), questionOptions);
    const result = resolveTabularFilePath(answer, {
      defaultPath: options.defaultPath,
      cwd: options.cwd,
      existsSync: options.existsSync,
    });

    if (result.ok) {
      return { path: result.path, kind: result.kind };
    }

    log(result.reason);
    await ask('Press Enter to try again (or Ctrl+C to cancel)', questionOptions);
  }
}
