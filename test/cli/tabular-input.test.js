import { promptForTabularInput } from '../../src/cli/tabular-input.js';

describe('promptForTabularInput', () => {
  it('retries when required columns are missing', async () => {
    const answers = ['bad.csv', '', 'good.csv'];
    /** @type {string[]} */
    const logs = [];
    let reads = 0;

    const result = await promptForTabularInput({
      requiredColumns: ['Provided EPPO Code', 'Provided Sciname'],
      cwd: '/tmp',
      existsSync: (path) => path.endsWith('.csv'),
      log: (message) => {
        logs.push(message);
      },
      question: async () => answers.shift() ?? '',
      readFile: async (file) => {
        reads += 1;
        if (file.path.endsWith('bad.csv')) {
          return { headers: ['Wrong'], rows: [] };
        }
        return {
          headers: ['Provided EPPO Code', 'Provided Sciname'],
          rows: [{ 'Provided EPPO Code': 'BEAVA', 'Provided Sciname': null }],
        };
      },
    });

    expect(reads).toBe(2);
    expect(result.kind).toBe('csv');
    expect(result.rows).toHaveLength(1);
    expect(logs.some((line) => line.includes('Missing required column'))).toBe(true);
  });
});
