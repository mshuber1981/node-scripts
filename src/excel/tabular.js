import ExcelJS from 'exceljs';
import { readCsv } from './csv.js';

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function cellValue(value) {
  if (value == null) {
    return null;
  }
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'object') {
    if ('result' in value) {
      return cellValue(value.result);
    }
    if ('text' in value && typeof value.text === 'string') {
      return value.text;
    }
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text ?? '').join('');
    }
  }
  return value;
}

/**
 * @param {unknown} value
 * @param {number} columnNumber
 * @returns {string}
 */
function headerKey(value, columnNumber) {
  const text = value == null ? '' : String(value).trim();
  if (!text) {
    throw new Error(`Header cell in column ${columnNumber} is empty`);
  }
  return text;
}

/**
 * @param {string} filePath
 * @param {object} [options]
 * @param {string | number} [options.sheet]
 * @param {number} [options.headerRow]
 * @returns {Promise<{ headers: string[], rows: Record<string, unknown>[] }>}
 */
async function readXlsxTabular(filePath, { sheet = 1, headerRow = 1 } = {}) {
  if (!Number.isInteger(headerRow) || headerRow < 1) {
    throw new TypeError('headerRow must be a positive integer');
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.getWorksheet(sheet);
  if (!worksheet) {
    throw new Error(`Worksheet not found: ${sheet}`);
  }

  const header = worksheet.getRow(headerRow);
  /** @type {string[]} */
  const headers = [];
  for (let column = 1; column <= header.cellCount; column += 1) {
    const key = headerKey(cellValue(header.getCell(column).value), column);
    if (headers.includes(key)) {
      throw new Error(`Duplicate column header "${key}"`);
    }
    headers.push(key);
  }

  /** @type {Record<string, unknown>[]} */
  const rows = [];
  for (let rowNumber = headerRow + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    /** @type {Record<string, unknown>} */
    const record = {};
    let hasValue = false;

    for (let index = 0; index < headers.length; index += 1) {
      const key = headers[index];
      const value = cellValue(row.getCell(index + 1).value);
      if (value != null && value !== '') {
        hasValue = true;
      }
      record[key] = value;
    }

    if (hasValue) {
      rows.push(record);
    }
  }

  return { headers, rows };
}

/**
 * Read a CSV or XLSX file into headers and row objects.
 *
 * @param {object} file
 * @param {string} file.path
 * @param {'csv' | 'xlsx'} file.kind
 * @param {object} [options]
 * @param {string | number} [options.sheet]
 * @param {number} [options.headerRow]
 * @returns {Promise<{ headers: string[], rows: Record<string, unknown>[] }>}
 */
export async function readTabularFile(file, options = {}) {
  if (file.kind === 'csv') {
    return readCsv(file.path, options);
  }
  if (file.kind === 'xlsx') {
    return readXlsxTabular(file.path, options);
  }
  throw new TypeError(`Unsupported tabular kind: ${file.kind}`);
}

/**
 * @param {string[]} headers
 * @param {string[]} requiredColumns
 * @returns {string[]}
 */
export function missingColumns(headers, requiredColumns) {
  const present = new Set(headers);
  return requiredColumns.filter((column) => !present.has(column));
}
