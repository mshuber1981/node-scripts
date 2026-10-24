import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promptForTabularFile, resolveTabularFilePath } from '../../src/cli/tabular-file.js';

describe('resolveTabularFilePath', () => {
  /** @type {string} */
  let directory;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'node-scripts-tabular-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('resolves an existing xlsx path relative to cwd', async () => {
    const filePath = join(directory, 'input.xlsx');
    await writeFile(filePath, 'xlsx');

    const result = resolveTabularFilePath('input.xlsx', { cwd: directory });

    expect(result).toEqual({ ok: true, path: filePath, kind: 'xlsx' });
  });

  it('resolves an existing csv path and strips wrapping quotes', async () => {
    const filePath = join(directory, 'input.csv');
    await writeFile(filePath, 'a,b\n');

    const result = resolveTabularFilePath(`"${filePath}"`);

    expect(result).toEqual({ ok: true, path: filePath, kind: 'csv' });
  });

  it('uses defaultPath when input is blank', async () => {
    const filePath = join(directory, 'default.xlsx');
    await writeFile(filePath, 'xlsx');

    const result = resolveTabularFilePath('   ', {
      cwd: directory,
      defaultPath: 'default.xlsx',
    });

    expect(result).toEqual({ ok: true, path: filePath, kind: 'xlsx' });
  });

  it('fails when input is blank and no default is provided', () => {
    const result = resolveTabularFilePath('');

    expect(result).toEqual({ ok: false, reason: 'A path is required.' });
  });

  it('rejects unsupported extensions when the file exists', async () => {
    const filePath = join(directory, 'notes.txt');
    await writeFile(filePath, 'nope');

    const result = resolveTabularFilePath('notes.txt', { cwd: directory });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/Unsupported file type "\.txt"/);
      expect(result.reason).toMatch(/\.csv or \.xlsx/);
    }
  });

  it('rejects unsupported extensions when the file is missing', () => {
    const result = resolveTabularFilePath('missing.txt', { cwd: directory });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/Unsupported file type "\.txt"/);
    }
  });

  it('appends .xlsx then .csv when the path has no extension', async () => {
    const csvPath = join(directory, 'data.csv');
    await writeFile(csvPath, 'a,b\n');

    const result = resolveTabularFilePath('data', { cwd: directory });

    expect(result).toEqual({ ok: true, path: csvPath, kind: 'csv' });
  });

  it('prefers .xlsx over .csv when guessing an extension', async () => {
    const xlsxPath = join(directory, 'data.xlsx');
    const csvPath = join(directory, 'data.csv');
    await writeFile(xlsxPath, 'xlsx');
    await writeFile(csvPath, 'a,b\n');

    const result = resolveTabularFilePath('data', { cwd: directory });

    expect(result).toEqual({ ok: true, path: xlsxPath, kind: 'xlsx' });
  });

  it('reports not found for a missing supported path', () => {
    const result = resolveTabularFilePath('missing.xlsx', { cwd: directory });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe(`File not found: ${join(directory, 'missing.xlsx')}`);
    }
  });

  it('treats extensions case-insensitively', async () => {
    const filePath = join(directory, 'INPUT.XLSX');
    await writeFile(filePath, 'xlsx');

    const result = resolveTabularFilePath('INPUT.XLSX', { cwd: directory });

    expect(result).toEqual({ ok: true, path: filePath, kind: 'xlsx' });
  });
});

describe('promptForTabularFile', () => {
  it('retries after a failed answer and returns the resolved file', async () => {
    const answers = ['missing.xlsx', '', 'good.csv'];
    /** @type {string[]} */
    const logs = [];
    const existing = new Set(['/tmp/good.csv']);

    const result = await promptForTabularFile({
      cwd: '/tmp',
      existsSync: (path) => existing.has(path),
      clear: () => {},
      log: (message) => {
        logs.push(message);
      },
      question: async () => answers.shift() ?? '',
    });

    expect(result).toEqual({ path: '/tmp/good.csv', kind: 'csv' });
    expect(logs[0]).toMatch(/File not found/);
  });
});
