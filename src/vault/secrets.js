import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DETAIL_LIMIT = 500;

/**
 * A Vault problem the person running the script can fix.
 * `code` is one of `vault-not-installed`, `vault-unavailable`,
 * `vault-not-authenticated`, `vault-unreadable`, `vault-invalid-response`,
 * or `vault-missing-field`.
 */
export class VaultError extends Error {
  /**
   * @param {string} message
   * @param {{ code: string, path?: string, reason?: string, cause?: unknown }} [details]
   */
  constructor(message, { code, path, reason, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'VaultError';
    this.code = code;
    this.path = path;
    this.reason = reason;
  }
}

/**
 * Failure from the `vault` process itself. Callers usually see {@link VaultError} instead.
 */
export class VaultCommandError extends Error {
  /**
   * @param {string} message
   * @param {{ args: string[], code?: string | number, stderr: string, killed: boolean }} details
   */
  constructor(message, { args, code, stderr, killed }) {
    super(message);
    this.name = 'VaultCommandError';
    this.args = args;
    this.code = code;
    this.stderr = stderr;
    this.killed = killed;
  }
}

/**
 * @param {string} file
 * @param {string[]} args
 * @param {import('node:child_process').ExecFileOptions} options
 */
function defaultExecFile(file, args, options) {
  return execFileAsync(file, args, options);
}

/**
 * Run the Vault CLI without a shell. `VAULT_ADDR`, `VAULT_TOKEN`, and the rest
 * of the environment are passed through.
 *
 * @param {string[]} args
 * @param {object} [options]
 * @param {string} [options.binary]
 * @param {number} [options.timeoutMs]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {typeof defaultExecFile} [options.execFile]
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
export async function runVault(args, options = {}) {
  const binary = options.binary ?? 'vault';
  const execFileImpl = options.execFile ?? defaultExecFile;

  try {
    const { stdout = '', stderr = '' } = await execFileImpl(binary, args, {
      encoding: 'utf8',
      timeout: options.timeoutMs ?? 15_000,
      maxBuffer: 1_048_576,
      env: options.env ?? process.env,
      windowsHide: true,
    });
    return { stdout, stderr };
  } catch (error) {
    throw new VaultCommandError(error instanceof Error ? error.message : 'Vault command failed', {
      args,
      code: /** @type {{ code?: string | number }} */ (error)?.code,
      stderr:
        typeof (/** @type {{ stderr?: unknown }} */ (error)?.stderr) === 'string'
          ? error.stderr
          : '',
      killed: Boolean(/** @type {{ killed?: boolean }} */ (error)?.killed),
    });
  }
}

/**
 * @param {string} value
 * @returns {string}
 */
function clip(value) {
  const trimmed = value.trim();
  if (trimmed.length <= DETAIL_LIMIT) {
    return trimmed;
  }
  return `${trimmed.slice(0, DETAIL_LIMIT)}…`;
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorDetail(error) {
  if (!(error instanceof VaultCommandError)) {
    return '';
  }
  return clip(error.stderr);
}

const NOT_INSTALLED = `Vault CLI is not installed or not on your PATH.

Install the Vault CLI (https://developer.hashicorp.com/vault/install), then log in with \`vault login\` and run this script again.`;

/**
 * @param {unknown} error
 * @param {'version' | 'lookup'} stage
 * @returns {VaultError}
 */
function explainStartupFailure(error, stage) {
  if (error instanceof VaultError) {
    return error;
  }

  const commandError = error instanceof VaultCommandError ? error : undefined;
  if (commandError?.code === 'ENOENT') {
    return new VaultError(NOT_INSTALLED, { code: 'vault-not-installed', cause: error });
  }

  if (commandError?.killed) {
    const command = stage === 'version' ? 'vault version' : 'vault token lookup';
    return new VaultError(
      `\`${command}\` timed out. Check VAULT_ADDR and the network, then try again.`,
      {
        code: 'vault-unavailable',
        cause: error,
      },
    );
  }

  const detail = errorDetail(error);
  if (stage === 'version') {
    return new VaultError(`Vault CLI could not be run.\n\n${detail || '`vault version` failed.'}`, {
      code: 'vault-unavailable',
      cause: error,
    });
  }

  return new VaultError(
    `Vault CLI is installed, but this session cannot use it.

\`vault token lookup\` failed:
${detail || 'Vault did not print an error.'}

Run \`vault login\` and confirm VAULT_ADDR is set, then try again.`,
    { code: 'vault-not-authenticated', cause: error },
  );
}

/**
 * Confirm the CLI is installed and the current session can talk to Vault.
 * This does not read any secret paths.
 *
 * @param {object} [options]
 * @param {(args: string[]) => Promise<{ stdout: string, stderr: string }>} [options.run]
 * @returns {Promise<void>}
 */
export async function assertVaultReady(options = {}) {
  const run = options.run ?? ((args) => runVault(args, options));

  try {
    await run(['version']);
  } catch (error) {
    throw explainStartupFailure(error, 'version');
  }

  try {
    await run(['token', 'lookup', '-non-interactive', '-format=json']);
  } catch (error) {
    throw explainStartupFailure(error, 'lookup');
  }
}

/**
 * @param {string} path
 */
function assertSafePath(path) {
  if (path.length === 0 || path.startsWith('-') || /[\0\r\n]/.test(path)) {
    throw new TypeError(`Vault path is not valid: ${JSON.stringify(path)}`);
  }
}

/**
 * @param {string} field
 */
function assertSafeField(field) {
  if (field.length === 0 || field.startsWith('-') || /[\0\r\n]/.test(field)) {
    throw new TypeError(`Vault field is not valid: ${JSON.stringify(field)}`);
  }
}

/**
 * @typedef {object} VaultField
 * @property {string} path
 * @property {string} field
 */

/**
 * @param {VaultField | undefined} locator
 * @param {string} name Name used in the error, such as `tokenUrl`.
 */
export function requireVaultField(locator, name) {
  const path = locator?.path;
  const field = locator?.field;
  if (
    typeof path !== 'string' ||
    typeof field !== 'string' ||
    path.trim() === '' ||
    field.trim() === ''
  ) {
    throw new TypeError(`${name} needs a non-empty path and field`);
  }
}

/**
 * @param {Record<string, VaultField>} requests
 * @returns {{ name: string, path: string, field: string }[]}
 */
function normalizeRequests(requests) {
  if (!requests || typeof requests !== 'object' || Array.isArray(requests)) {
    throw new TypeError('readVaultValues expects an object of { path, field } entries');
  }

  const entries = Object.entries(requests);
  if (entries.length === 0) {
    throw new TypeError('readVaultValues needs at least one field');
  }

  return entries.map(([name, locator]) => {
    if (!locator || typeof locator.path !== 'string' || typeof locator.field !== 'string') {
      throw new TypeError(`${name} must be { path, field }`);
    }
    assertSafePath(locator.path);
    assertSafeField(locator.field);
    return { name, path: locator.path, field: locator.field };
  });
}

/**
 * @param {string} detail
 * @returns {'permission' | 'missing' | 'other'}
 */
function classifyReadFailure(detail) {
  if (/permission denied|code:\s*403|forbidden/i.test(detail)) {
    return 'permission';
  }
  if (/no value found|not found|code:\s*404/i.test(detail)) {
    return 'missing';
  }
  return 'other';
}

/**
 * @param {string} path
 * @param {unknown} error
 * @returns {VaultError}
 */
function pathReadError(path, error) {
  const commandError = error instanceof VaultCommandError ? error : undefined;
  const detail = errorDetail(error);
  const reason = commandError?.killed ? 'timeout' : classifyReadFailure(detail);
  const summary = {
    permission: 'permission denied',
    missing: 'no secret at this path',
    timeout: 'timed out',
    other: 'could not be read',
  }[reason];
  const message =
    detail && reason !== 'timeout' ? `${path}: ${summary}\n${detail}` : `${path}: ${summary}`;

  return new VaultError(message, {
    code: 'vault-unreadable',
    path,
    reason,
    cause: error,
  });
}

/**
 * @param {string[]} reasons
 * @returns {string}
 */
function hintFor(reasons) {
  const unique = new Set(reasons);
  if (unique.size === 1 && unique.has('permission')) {
    return 'Request read access to the paths above, then run the script again.';
  }
  if (unique.size === 1 && unique.has('missing')) {
    return 'Check those paths, then run the script again.';
  }
  if (unique.size === 1 && unique.has('timeout')) {
    return 'Vault did not respond in time. Check VAULT_ADDR and the network, then try again.';
  }
  return 'Fix the paths above, then run the script again.';
}

/**
 * @param {VaultError} error
 * @returns {string}
 */
function bullet(error) {
  const [first, ...rest] = error.message.split('\n');
  return [`- ${first}`, ...rest.map((line) => (line.length > 0 ? `  ${line}` : ''))].join('\n');
}

/**
 * @param {unknown} payload
 * @param {string} path
 * @returns {Record<string, unknown>}
 */
function secretData(payload, path) {
  if (!payload || typeof payload !== 'object' || !('data' in payload)) {
    throw new VaultError(`Vault returned JSON for ${path} that did not contain secret data.`, {
      code: 'vault-invalid-response',
      path,
    });
  }

  const data = /** @type {{ data?: unknown, metadata?: unknown }} */ (payload).data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new VaultError(`Vault returned JSON for ${path} that did not contain secret data.`, {
      code: 'vault-invalid-response',
      path,
    });
  }

  if (
    'data' in data &&
    data.data &&
    typeof data.data === 'object' &&
    !Array.isArray(data.data) &&
    'metadata' in data &&
    data.metadata &&
    typeof data.metadata === 'object'
  ) {
    return /** @type {Record<string, unknown>} */ (data.data);
  }

  return /** @type {Record<string, unknown>} */ (data);
}

/**
 * @param {(args: string[]) => Promise<{ stdout: string, stderr: string }>} run
 * @param {string} path
 * @returns {Promise<Record<string, unknown>>}
 */
async function readPath(run, path) {
  let stdout;
  try {
    ({ stdout } = await run(['kv', 'get', '-non-interactive', '-format=json', path]));
  } catch (error) {
    if (error instanceof VaultError) {
      throw error;
    }
    throw pathReadError(path, error);
  }

  let payload;
  try {
    payload = JSON.parse(stdout);
  } catch (error) {
    throw new VaultError(`Vault returned data for ${path} that was not valid JSON.`, {
      code: 'vault-invalid-response',
      path,
      cause: error,
    });
  }

  return secretData(payload, path);
}

/**
 * @param {Map<string, Record<string, unknown>>} secrets
 * @param {{ name: string, path: string, field: string }[]} entries
 * @returns {Record<string, string>}
 */
function pickFields(secrets, entries) {
  /** @type {string[]} */
  const problems = [];
  /** @type {Record<string, string>} */
  const result = {};

  for (const entry of entries) {
    const data = secrets.get(entry.path) ?? {};
    const value = data[entry.field];
    const names = Object.keys(data).sort();
    const available = names.length > 0 ? names.join(', ') : '(none)';

    if (!Object.hasOwn(data, entry.field) || value == null) {
      problems.push(
        `${entry.path} has no "${entry.field}" field. Fields in that secret: ${available}.`,
      );
      continue;
    }
    if (value === '') {
      problems.push(`${entry.path} field "${entry.field}" is empty.`);
      continue;
    }
    if (typeof value !== 'string' && typeof value !== 'number') {
      problems.push(`${entry.path} field "${entry.field}" must be text.`);
      continue;
    }
    result[entry.name] = String(value);
  }

  if (problems.length > 0) {
    throw new VaultError(
      `Vault is readable, but required fields are missing or empty:\n\n${problems.map((problem) => `- ${problem}`).join('\n')}`,
      { code: 'vault-missing-field' },
    );
  }

  return result;
}

/**
 * Read named fields from Vault KV paths.
 * The same path is read once even when several fields come from it.
 * Fails before returning when the CLI is missing, the session cannot talk to
 * Vault, a path cannot be read, or a requested field is missing.
 *
 * @param {Record<string, VaultField>} requests
 * @param {object} [options]
 * @param {(args: string[]) => Promise<{ stdout: string, stderr: string }>} [options.run]
 * @returns {Promise<Record<string, string>>}
 */
export async function readVaultValues(requests, options = {}) {
  const entries = normalizeRequests(requests);
  const run = options.run ?? ((args) => runVault(args, options));
  await assertVaultReady({ ...options, run });

  /** @type {Map<string, Set<string>>} */
  const byPath = new Map();
  for (const entry of entries) {
    const fields = byPath.get(entry.path) ?? new Set();
    fields.add(entry.field);
    byPath.set(entry.path, fields);
  }

  /** @type {Map<string, Record<string, unknown>>} */
  const secrets = new Map();
  /** @type {VaultError[]} */
  const failures = [];

  for (const path of byPath.keys()) {
    try {
      secrets.set(path, await readPath(run, path));
    } catch (error) {
      if (error instanceof VaultError && error.code === 'vault-invalid-response') {
        throw error;
      }
      failures.push(error instanceof VaultError ? error : pathReadError(path, error));
    }
  }

  if (failures.length > 0) {
    throw new VaultError(
      `Cannot read the Vault secrets this script needs.\n\n${failures.map(bullet).join('\n\n')}\n\n${hintFor(
        failures.map((failure) => failure.reason ?? 'other'),
      )}`,
      { code: 'vault-unreadable', cause: failures[0] },
    );
  }

  return pickFields(secrets, entries);
}

/**
 * Read one KV secret and return its field names. Values are not included.
 *
 * @param {string} path
 * @param {object} [options]
 * @param {(args: string[]) => Promise<{ stdout: string, stderr: string }>} [options.run]
 * @returns {Promise<string[]>}
 */
export async function listVaultFields(path, options = {}) {
  if (typeof path !== 'string') {
    throw new TypeError('Vault path must be a string');
  }
  assertSafePath(path);
  const run = options.run ?? ((args) => runVault(args, options));
  await assertVaultReady({ ...options, run });
  const data = await readPath(run, path);
  return Object.keys(data).sort();
}
