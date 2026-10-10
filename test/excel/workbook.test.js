import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { readSheet, writeWorkbook } from '../../src/excel/workbook.js';

describe('workbooks', () => {
  /** @type {string} */
  let directory;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'node-scripts-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('writes a report and reads the rows back', async () => {
    const filePath = join(directory, 'nested', 'report.xlsx');
    const when = new Date(Date.UTC(2026, 0, 15, 12, 0, 0));

    await writeWorkbook(filePath, [
      {
        name: 'Summary',
        columns: [
          { header: 'Name', key: 'name', width: 24 },
          { header: 'Count', key: 'count', width: 12 },
          { header: 'When', key: 'when', width: 24 },
        ],
        rows: [
          { name: 'Alpha', count: 3, when },
          { name: '', count: null, when: null },
          { name: 'Beta', count: 8, when },
        ],
      },
    ]);

    const rows = await readSheet(filePath, { sheet: 'Summary' });

    expect(rows).toEqual([
      { Name: 'Alpha', Count: 3, When: expect.any(Date) },
      { Name: 'Beta', Count: 8, When: expect.any(Date) },
    ]);
    expect(rows[0].When).toEqual(when);
  });

  it('styles hyperlink cells as blue underlined links', async () => {
    const filePath = join(directory, 'links.xlsx');

    await writeWorkbook(filePath, [
      {
        name: 'Links',
        columns: [
          { header: 'Name', key: 'name', width: 24 },
          { header: 'Count', key: 'count', width: 12 },
        ],
        rows: [
          {
            name: { text: 'Questions', hyperlink: 'https://example.com/questions' },
            count: 3,
          },
        ],
      },
    ]);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const worksheet = workbook.getWorksheet('Links');
    const link = worksheet.getCell('A2');
    const plain = worksheet.getCell('B2');

    expect(link.value).toEqual({
      text: 'Questions',
      hyperlink: 'https://example.com/questions',
    });
    expect(link.font).toMatchObject({ color: { argb: 'FF0563C1' }, underline: true });
    expect(plain.font).toBeUndefined();
    expect(worksheet.getRow(1).font).toMatchObject({ bold: true });
  });

  it('returns the cached result of a formula cell', async () => {
    const filePath = join(directory, 'formula.xlsx');
    await writeWorkbook(filePath, [
      {
        name: 'Totals',
        columns: [
          { header: 'Left', key: 'left' },
          { header: 'Right', key: 'right' },
          { header: 'Sum', key: 'sum' },
        ],
        rows: [{ left: 2, right: 3, sum: null }],
      },
    ]);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const worksheet = workbook.getWorksheet('Totals');
    worksheet.getCell('C2').value = { formula: 'A2+B2', result: 5 };
    await workbook.xlsx.writeFile(filePath);

    await expect(readSheet(filePath)).resolves.toEqual([{ Left: 2, Right: 3, Sum: 5 }]);
  });

  it('rejects a missing worksheet and a duplicate header', async () => {
    const filePath = join(directory, 'report.xlsx');
    await writeWorkbook(filePath, [
      {
        name: 'Summary',
        columns: [{ header: 'Name', key: 'name' }],
        rows: [{ name: 'Alpha' }],
      },
    ]);

    await expect(readSheet(filePath, { sheet: 'Missing' })).rejects.toThrow(
      'Worksheet not found: Missing',
    );

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    workbook.getWorksheet('Summary').getCell('B1').value = 'Name';
    await workbook.xlsx.writeFile(filePath);

    await expect(readSheet(filePath)).rejects.toThrow('Duplicate column header "Name"');
  });

  it('requires at least one named sheet with columns', async () => {
    const filePath = join(directory, 'empty.xlsx');

    await expect(writeWorkbook(filePath, [])).rejects.toThrow('sheets must be a non-empty array');
    await expect(
      writeWorkbook(filePath, [{ name: '', columns: [{ header: 'A', key: 'a' }] }]),
    ).rejects.toThrow('Each sheet needs a name');
    await expect(writeWorkbook(filePath, [{ name: 'Summary', columns: [] }])).rejects.toThrow(
      'Sheet "Summary" needs columns',
    );
  });
});
