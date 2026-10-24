import { jest } from '@jest/globals';
import {
  assertVaultReady,
  listVaultFields,
  readVaultValues,
  requireVaultField,
  runVault,
  VaultCommandError,
  VaultError,
} from '../../src/vault/secrets.js';

/**
 * @param {object} [overrides]
 * @param {Error} [overrides.version]
 * @param {Error} [overrides.lookup]
 * @param {Record<string, object | Error>} [overrides.secrets]
 */
function vaultDouble({ version, lookup, secrets = {} } = {}) {
  /** @type {string[][]} */
  const calls = [];

  /**
   * @param {string[]} args
   */
  async function run(args) {
    calls.push(args);
    if (args[0] === 'version') {
      if (version) {
        throw version;
      }
      return { stdout: 'Vault v2.0.0\n', stderr: '' };
    }
    if (args[0] === 'token') {
      if (lookup) {
        throw lookup;
      }
      return { stdout: '{}\n', stderr: '' };
    }
    if (args[0] === 'kv') {
      const path = args.at(-1);
      const secret = secrets[path];
      if (!secret) {
        throw new VaultCommandError('missing', {
          args,
          code: 2,
          stderr: `No value found at ${path}`,
          killed: false,
        });
      }
      if (secret instanceof Error) {
        throw secret;
      }
      return { stdout: JSON.stringify(secret), stderr: '' };
    }
    throw new Error(`unexpected vault args: ${args.join(' ')}`);
  }

  return { run, calls };
}

function commandError({ code = 2, stderr = '', killed = false } = {}) {
  return new VaultCommandError('failed', { args: [], code, stderr, killed });
}

function kv2(fields) {
  return { data: { data: fields, metadata: { version: 1 } } };
}

describe('assertVaultReady', () => {
  it('stops when the vault binary is missing and does not try to log in', async () => {
    const { run, calls } = vaultDouble({
      version: commandError({ code: 'ENOENT' }),
    });

    await expect(assertVaultReady({ run })).rejects.toThrow(VaultError);
    await expect(assertVaultReady({ run })).rejects.toThrow(/not installed or not on your PATH/);
    expect(calls.some((args) => args[0] === 'token')).toBe(false);
  });

  it('stops when the CLI is installed but the session cannot use Vault', async () => {
    const { run, calls } = vaultDouble({
      lookup: commandError({ stderr: 'Error looking up token: missing client token' }),
    });

    await expect(assertVaultReady({ run })).rejects.toMatchObject({
      code: 'vault-not-authenticated',
    });
    await expect(assertVaultReady({ run })).rejects.toThrow(/vault login/);
    expect(calls.some((args) => args[0] === 'kv')).toBe(false);
  });
});

describe('readVaultValues', () => {
  it('reads several fields from one KV v2 path with a single vault call', async () => {
    const { run, calls } = vaultDouble({
      secrets: {
        'secret/reporting': kv2({
          client_id: 'client-123',
          client_secret: 'secret-456',
        }),
      },
    });

    await expect(
      readVaultValues(
        {
          clientId: { path: 'secret/reporting', field: 'client_id' },
          clientSecret: { path: 'secret/reporting', field: 'client_secret' },
        },
        { run },
      ),
    ).resolves.toEqual({
      clientId: 'client-123',
      clientSecret: 'secret-456',
    });

    const reads = calls.filter((args) => args[0] === 'kv');
    expect(reads).toEqual([['kv', 'get', '-non-interactive', '-format=json', 'secret/reporting']]);
  });

  it('reads a KV v1 secret and stringifies numeric fields', async () => {
    const { run } = vaultDouble({
      secrets: {
        'secret/legacy': { data: { client_id: 4401 } },
      },
    });

    await expect(
      readVaultValues({ clientId: { path: 'secret/legacy', field: 'client_id' } }, { run }),
    ).resolves.toEqual({ clientId: '4401' });
  });

  it('lists every unreadable path and does not include secret values', async () => {
    const { run } = vaultDouble({
      secrets: {
        'secret/reporting': commandError({
          stderr: 'Code: 403. Errors:\n* permission denied',
        }),
        'secret/other': commandError({
          stderr: 'No value found at secret/other',
        }),
      },
    });

    let error;
    try {
      await readVaultValues(
        {
          clientId: { path: 'secret/reporting', field: 'client_id' },
          other: { path: 'secret/other', field: 'client_secret' },
        },
        { run },
      );
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(VaultError);
    expect(error.code).toBe('vault-unreadable');
    expect(error.message).toContain('secret/reporting: permission denied');
    expect(error.message).toContain('secret/other: no secret at this path');
    expect(error.message).toContain('Fix the paths above');
    expect(error.message).not.toContain('super-secret');
  });

  it('names a missing field without printing the other values', async () => {
    const { run } = vaultDouble({
      secrets: {
        'secret/reporting': kv2({ client_id: 'visible-name', client_secret: 'super-secret' }),
      },
    });

    let error;
    try {
      await readVaultValues(
        { tokenUrl: { path: 'secret/reporting', field: 'token_url' } },
        { run },
      );
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({ code: 'vault-missing-field' });
    expect(error.message).toContain('has no "token_url" field');
    expect(error.message).toContain('client_id, client_secret');
    expect(error.message).not.toContain('super-secret');
    expect(error.message).not.toContain('visible-name');
  });

  it('rejects an invalid path before running vault', async () => {
    const run = jest.fn();

    await expect(
      readVaultValues({ clientId: { path: '-secret', field: 'client_id' } }, { run }),
    ).rejects.toThrow(/Vault path is not valid/);
    expect(run).not.toHaveBeenCalled();
  });

  it('does not read secrets when Vault is not authenticated', async () => {
    const { run, calls } = vaultDouble({
      lookup: commandError({ stderr: 'missing client token' }),
    });

    await expect(
      readVaultValues({ clientId: { path: 'secret/reporting', field: 'client_id' } }, { run }),
    ).rejects.toMatchObject({ code: 'vault-not-authenticated' });
    expect(calls.some((args) => args[0] === 'kv')).toBe(false);
  });
});

describe('listVaultFields', () => {
  it('returns field names and not values', async () => {
    const { run } = vaultDouble({
      secrets: {
        'secret/reporting': kv2({ client_secret: 'super-secret', client_id: 'id' }),
      },
    });

    const fields = await listVaultFields('secret/reporting', { run });
    expect(fields).toEqual(['client_id', 'client_secret']);
    expect(fields.join(' ')).not.toContain('super-secret');
  });
});

describe('requireVaultField', () => {
  it('accepts a locator with a path and field', () => {
    expect(() =>
      requireVaultField({ path: 'secret/reporting', field: 'client_id' }, 'clientId'),
    ).not.toThrow();
  });

  it('rejects a missing locator or a blank path or field', () => {
    expect(() => requireVaultField(undefined, 'tokenUrl')).toThrow(
      'tokenUrl needs a non-empty path and field',
    );
    expect(() => requireVaultField({ path: '  ', field: 'client_id' }, 'clientId')).toThrow(
      TypeError,
    );
    expect(() =>
      requireVaultField({ path: 'secret/reporting', field: '' }, 'clientSecret'),
    ).toThrow('clientSecret needs a non-empty path and field');
  });
});

describe('runVault', () => {
  it('returns stdout from the vault binary', async () => {
    const execFile = jest.fn(async () => ({ stdout: 'Vault v2.0.0\n', stderr: '' }));

    await expect(runVault(['version'], { execFile })).resolves.toEqual({
      stdout: 'Vault v2.0.0\n',
      stderr: '',
    });
    expect(execFile).toHaveBeenCalledWith(
      'vault',
      ['version'],
      expect.objectContaining({ encoding: 'utf8', env: process.env }),
    );
  });

  it('reports a missing binary without a shell', async () => {
    const execFile = jest.fn(async () => {
      const error = new Error('spawn vault ENOENT');
      error.code = 'ENOENT';
      error.stderr = '';
      throw error;
    });

    await expect(runVault(['version'], { execFile })).rejects.toMatchObject({
      name: 'VaultCommandError',
      code: 'ENOENT',
    });
  });
});
