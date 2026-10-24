import { loadEnvFile } from '../../src/env/load-env.js';

describe('loadEnvFile', () => {
  it('loads unset keys and does not override existing ones', () => {
    /** @type {NodeJS.ProcessEnv} */
    const env = { EXISTING: 'keep' };

    loadEnvFile('/fake/.env', {
      env,
      readFileSync: () => 'EXISTING=new\nEPPO_KEY="secret"\n# comment\nEMPTY=\n',
    });

    expect(env.EXISTING).toBe('keep');
    expect(env.EPPO_KEY).toBe('secret');
    expect(env.EMPTY).toBe('');
  });

  it('ignores a missing file', () => {
    /** @type {NodeJS.ProcessEnv} */
    const env = {};

    loadEnvFile('/missing/.env', {
      env,
      readFileSync: () => {
        const error = new Error('missing');
        error.code = 'ENOENT';
        throw error;
      },
    });

    expect(env).toEqual({});
  });
});
