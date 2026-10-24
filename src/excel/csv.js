import { readFile } from 'node:fs/promises';

/**
 * @param {string} text
 * @returns {string[][]}
 */
function parseCsv(text) {
  /** @type {string[][]} */
  const rows = [];
  /** @type {string[]} */
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ',') {
      row.push(field);
      field = '';
      continue;
    }

    if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }

    if (char === '\r') {
      continue;
    }

    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/**
 * Read a CSV file into header names and row objects keyed by those headers.
 * Blank data rows are skipped.
 *
 * @param {string} filePath
 * @param {object} [options]
 * @param {number} [options.headerRow] 1-based header row. Defaults to 1.
 * @returns {Promise<{ headers: string[], rows: Record<string, unknown>[] }>}
 */
export async function readCsv(filePath, { headerRow = 1 } = {}) {
  if (!Number.isInteger(headerRow) || headerRow < 1) {
    throw new TypeError('headerRow must be a positive integer');
  }

  const text = await readFile(filePath, 'utf8');
  const table = parseCsv(text);
  const headerIndex = headerRow - 1;

  if (table.length <= headerIndex) {
    throw new Error('CSV file has no header row');
  }

  /** @type {string[]} */
  const headers = [];
  const headerCells = table[headerIndex];
  for (let column = 0; column < headerCells.length; column += 1) {
    const key = String(headerCells[column] ?? '').trim();
    if (!key) {
      throw new Error(`Header cell in column ${column + 1} is empty`);
    }
    if (headers.includes(key)) {
      throw new Error(`Duplicate column header "${key}"`);
    }
    headers.push(key);
  }

  /** @type {Record<string, unknown>[]} */
  const rows = [];
  for (let rowIndex = headerIndex + 1; rowIndex < table.length; rowIndex += 1) {
    const cells = table[rowIndex];
    /** @type {Record<string, unknown>} */
    const record = {};
    let hasValue = false;

    for (let index = 0; index < headers.length; index += 1) {
      const raw = cells[index] ?? '';
      const value = raw === '' ? null : raw;
      if (value != null) {
        hasValue = true;
      }
      record[headers[index]] = value;
    }

    if (hasValue) {
      rows.push(record);
    }
  }

  return { headers, rows };
}
