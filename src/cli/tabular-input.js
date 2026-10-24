import { ask } from './ask.js';
import { promptForTabularFile } from './tabular-file.js';
import { missingColumns, readTabularFile } from '../excel/tabular.js';

/**
 * @typedef {object} TabularInputResult
 * @property {string} path
 * @property {'csv' | 'xlsx'} kind
 * @property {string[]} headers
 * @property {Record<string, unknown>[]} rows
 */

/**
 * Prompt for a CSV/XLSX file, read it, and retry until required columns are present.
 * Each prompt opens and closes readline so later prompts still work after file I/O.
 *
 * @param {object} options
 * @param {string[]} options.requiredColumns
 * @param {string} [options.defaultPath]
 * @param {string} [options.message]
 * @param {string} [options.cwd]
 * @param {(path: string) => boolean} [options.existsSync]
 * @param {(prompt: string) => Promise<string>} [options.question]
 * @param {(message?: string) => void} [options.log]
 * @param {(file: { path: string, kind: 'csv' | 'xlsx' }) => Promise<{ headers: string[], rows: Record<string, unknown>[] }>} [options.readFile]
 * @returns {Promise<TabularInputResult>}
 */
export async function promptForTabularInput(options) {
  const requiredColumns = options.requiredColumns;
  if (!Array.isArray(requiredColumns) || requiredColumns.length === 0) {
    throw new TypeError('requiredColumns must be a non-empty array');
  }

  const log = options.log ?? console.log;
  const readFile = options.readFile ?? readTabularFile;
  const questionOptions = options.question ? { question: options.question } : {};

  for (;;) {
    const file = await promptForTabularFile({
      defaultPath: options.defaultPath,
      message: options.message,
      cwd: options.cwd,
      existsSync: options.existsSync,
      question: options.question,
      log,
    });

    const { headers, rows } = await readFile(file);
    const missing = missingColumns(headers, requiredColumns);

    if (missing.length === 0) {
      return { path: file.path, kind: file.kind, headers, rows };
    }

    log(
      `Missing required column(s): ${missing.join(', ')}.\nExpected columns: ${requiredColumns.join(', ')}.`,
    );
    await ask('Press Enter to choose another file (or Ctrl+C to cancel)', questionOptions);
  }
}
