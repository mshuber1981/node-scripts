import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeWorkbook } from '../../src/excel/workbook.js';
import { missingColumns, readTabularFile } from '../../src/excel/tabular.js';
import { readCsv } from '../../src/excel/csv.js';

describe('missingColumns', () => {
  it('returns headers that are absent', () => {
    expect(missingColumns(['A', 'B'], ['A', 'C', 'B'])).toEqual(['C']);
  });

  it('returns an empty list when all required columns are present', () => {
    expect(missingColumns(['A', 'B'], ['B', 'A'])).toEqual([]);
  });
});

describe('readCsv and readTabularFile', () => {
  /** @type {string} */
  let directory;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'node-scripts-tabular-read-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('reads csv headers and rows', async () => {
    const filePath = join(directory, 'input.csv');
    await writeFile(filePath, 'Provided EPPO Code,Provided Sciname\nBEAVA,Name\n,\n');

    const result = await readCsv(filePath);

    expect(result.headers).toEqual(['Provided EPPO Code', 'Provided Sciname']);
    expect(result.rows).toEqual([{ 'Provided EPPO Code': 'BEAVA', 'Provided Sciname': 'Name' }]);
  });

  it('reads xlsx through readTabularFile', async () => {
    const filePath = join(directory, 'input.xlsx');
    await writeWorkbook(filePath, [
      {
        name: 'Sheet1',
        columns: [
          { header: 'Provided EPPO Code', key: 'code', width: 18 },
          { header: 'Provided Sciname', key: 'name', width: 24 },
        ],
        rows: [{ code: 'CERCSG', name: '' }],
      },
    ]);

    const result = await readTabularFile({ path: filePath, kind: 'xlsx' });

    expect(result.headers).toEqual(['Provided EPPO Code', 'Provided Sciname']);
    expect(result.rows).toEqual([{ 'Provided EPPO Code': 'CERCSG', 'Provided Sciname': '' }]);
  });
});
