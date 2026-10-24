import { resolveSavePath, promptForSavePath } from '../../src/cli/save-path.js';

describe('resolveSavePath', () => {
  it('resolves a relative xlsx path against cwd', () => {
    const result = resolveSavePath('out/report.xlsx', { cwd: '/tmp/work' });

    expect(result).toEqual({ ok: true, path: '/tmp/work/out/report.xlsx' });
  });

  it('uses defaultPath when input is blank', () => {
    const result = resolveSavePath('  ', {
      cwd: '/tmp',
      defaultPath: 'llm-scratch/output_102426.xlsx',
    });

    expect(result).toEqual({
      ok: true,
      path: '/tmp/llm-scratch/output_102426.xlsx',
    });
  });

  it('appends .xlsx when the path has no extension', () => {
    const result = resolveSavePath('llm-scratch/output_102426', { cwd: '/tmp' });

    expect(result).toEqual({
      ok: true,
      path: '/tmp/llm-scratch/output_102426.xlsx',
    });
  });

  it('rejects non-xlsx extensions', () => {
    const result = resolveSavePath('report.csv', { cwd: '/tmp' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/Expected \.xlsx/);
    }
  });

  it('fails when input is blank and no default is provided', () => {
    expect(resolveSavePath('')).toEqual({ ok: false, reason: 'A path is required.' });
  });
});

describe('promptForSavePath', () => {
  it('retries after a failed answer and returns the path', async () => {
    const answers = ['bad.csv', '', 'ok.xlsx'];
    /** @type {string[]} */
    const logs = [];

    const path = await promptForSavePath({
      cwd: '/tmp',
      clear: () => {},
      log: (message) => {
        logs.push(message);
      },
      question: async () => answers.shift() ?? '',
    });

    expect(path).toBe('/tmp/ok.xlsx');
    expect(logs[0]).toMatch(/Expected \.xlsx/);
  });
});
