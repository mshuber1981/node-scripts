import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import ExcelJS from 'exceljs';

/**
 * @typedef {object} ReportColumn
 * @property {string} header
 * @property {string} key
 * @property {number} [width]
 */

/**
 * @typedef {object} HyperlinkValue
 * @property {string} text Display text.
 * @property {string} hyperlink Link target. Use `#'Sheet'!A1` for a cell in this workbook.
 */

/**
 * @typedef {object} ReportSheet
 * @property {string} name
 * @property {ReportColumn[]} columns
 * @property {Record<string, unknown>[]} [rows] A cell may be a {@link HyperlinkValue}.
 */

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
 * @param {number} columnNumber 1-based column index, used in the error message.
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
 * @param {import('exceljs').Workbook} workbook
 * @param {string | number} sheet
 * @returns {import('exceljs').Worksheet}
 */
function resolveWorksheet(workbook, sheet) {
  const worksheet = workbook.getWorksheet(sheet);
  if (!worksheet) {
    throw new Error(`Worksheet not found: ${sheet}`);
  }
  return worksheet;
}

/**
 * @param {unknown} value
 * @returns {value is HyperlinkValue}
 */
function isHyperlink(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    'hyperlink' in value &&
    typeof value.hyperlink === 'string' &&
    value.hyperlink.length > 0
  );
}

/**
 * @param {import('exceljs').Worksheet} worksheet
 * @param {number} columnCount
 */
function styleHyperlinks(worksheet, columnCount) {
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    for (let column = 1; column <= columnCount; column += 1) {
      const cell = row.getCell(column);
      if (isHyperlink(cell.value)) {
        cell.font = { color: { argb: 'FF0563C1' }, underline: true };
      }
    }
  }
}

/**
 * Write a workbook of tabular sheets. The header row is bold, frozen, and filtered.
 * Hyperlink cells are blue and underlined. Parent directories are created when they are missing.
 *
 * @param {string} filePath
 * @param {ReportSheet[]} sheets
 * @returns {Promise<void>}
 */
export async function writeWorkbook(filePath, sheets) {
  if (!Array.isArray(sheets) || sheets.length === 0) {
    throw new TypeError('sheets must be a non-empty array');
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'node-scripts';

  for (const sheet of sheets) {
    if (!sheet?.name) {
      throw new TypeError('Each sheet needs a name');
    }
    if (!Array.isArray(sheet.columns) || sheet.columns.length === 0) {
      throw new TypeError(`Sheet "${sheet.name}" needs columns`);
    }

    const worksheet = workbook.addWorksheet(sheet.name);
    worksheet.columns = sheet.columns;
    worksheet.addRows(sheet.rows ?? []);
    styleHyperlinks(worksheet, sheet.columns.length);
    worksheet.getRow(1).font = { bold: true };
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];
    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: sheet.columns.length },
    };
  }

  await mkdir(dirname(filePath), { recursive: true });
  await workbook.xlsx.writeFile(filePath);
}

/**
 * Read a worksheet into objects keyed by the header row.
 * Blank rows are skipped. Formula cells return their cached result.
 *
 * @param {string} filePath
 * @param {object} [options]
 * @param {string | number} [options.sheet] Worksheet name or 1-based index. Defaults to the first sheet.
 * @param {number} [options.headerRow] 1-based header row. Defaults to 1.
 * @returns {Promise<Record<string, unknown>[]>}
 */
export async function readSheet(filePath, { sheet = 1, headerRow = 1 } = {}) {
  if (!Number.isInteger(headerRow) || headerRow < 1) {
    throw new TypeError('headerRow must be a positive integer');
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = resolveWorksheet(workbook, sheet);
  const header = worksheet.getRow(headerRow);
  /** @type {string[]} */
  const keys = [];

  for (let column = 1; column <= header.cellCount; column += 1) {
    const key = headerKey(cellValue(header.getCell(column).value), column);
    if (keys.includes(key)) {
      throw new Error(`Duplicate column header "${key}"`);
    }
    keys.push(key);
  }

  /** @type {Record<string, unknown>[]} */
  const rows = [];
  for (let rowNumber = headerRow + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    /** @type {Record<string, unknown>} */
    const record = {};
    let hasValue = false;

    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
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

  return rows;
}
