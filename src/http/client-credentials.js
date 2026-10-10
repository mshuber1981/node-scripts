import { HTTPError } from 'got';
import { createHttpClient } from './client.js';
import { createTokenManager } from './token-manager.js';
import { readVaultValues, VaultError } from '../vault/secrets.js';

/**
 * @param {string} value
 */
function assertHttpUrl(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError('URL must be an absolute http or https URL');
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError('URL must be an absolute http or https URL');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new TypeError('URL must be an absolute http or https URL');
  }
  if (url.username || url.password) {
    throw new TypeError('URL must not include a username or password');
  }
}

/**
 * Origin and path only, so a query string cannot leak into an error message.
 *
 * @param {string} tokenUrl
 * @returns {string}
 */
function safeTokenUrl(tokenUrl) {
  const url = new URL(tokenUrl);
  return `${url.origin}${url.pathname}`;
}

/**
 * @param {unknown} body
 * @returns {string}
 */
function oauthFailure(body) {
  let record = body;
  if (typeof body === 'string') {
    try {
      record = JSON.parse(body);
    } catch {
      return '';
    }
  }
  if (!record || typeof record !== 'object') {
    return '';
  }
  const details = /** @type {Record<string, unknown>} */ (record);
  const code = typeof details.error === 'string' ? details.error : '';
  const description =
    typeof details.error_description === 'string' ? details.error_description : '';
  if (code && description) {
    return `${code}: ${description}`;
  }
  return code || description;
}

/**
 * @param {string} message
 * @param {string[]} secrets
 * @returns {string}
 */
function redact(message, secrets) {
  let redacted = message;
  for (const secret of secrets) {
    if (secret) {
      redacted = redacted.replaceAll(secret, '[redacted]');
    }
  }
  return redacted;
}

/**
 * @param {string} tokenUrl
 * @param {unknown} error
 * @param {string[]} [secrets]
 * @returns {Error}
 */
function tokenRequestError(tokenUrl, error, secrets = []) {
  const target = safeTokenUrl(tokenUrl);
  if (error instanceof HTTPError) {
    const detail = redact(oauthFailure(error.response.body), secrets);
    const status = `Client-credentials token request to ${target} failed with status ${error.response.statusCode}.`;
    const message = detail ? `${status}\n${detail}` : status;
    return new Error(message, { cause: error });
  }

  const message = error instanceof Error ? error.message : 'unknown error';
  return new Error(`Client-credentials token request to ${target} failed: ${message}`, {
    cause: error,
  });
}

/**
 * `{clientId}` in a scope is replaced with the client id read from Vault.
 *
 * @param {string | undefined} scope
 * @param {string} clientId
 * @returns {string | undefined}
 */
function resolveScope(scope, clientId) {
  if (scope === undefined) {
    return undefined;
  }
  return scope.replaceAll('{clientId}', clientId);
}

/**
 * Exchange a client id and secret for an access token.
 * The request is `application/x-www-form-urlencoded` with `grant_type=client_credentials`.
 *
 * @param {object} options
 * @param {string} options.tokenUrl
 * @param {string} options.clientId
 * @param {string} options.clientSecret
 * @param {string} [options.scope] `{clientId}` is replaced with the client id.
 * @param {number} [options.timeoutMs]
 * @param {import('got').Got} [options.client]
 * @returns {Promise<{ accessToken: string, expiresIn: number }>}
 */
export async function fetchClientCredentialsToken({
  tokenUrl,
  clientId,
  clientSecret,
  scope,
  timeoutMs = 10_000,
  client = createHttpClient({ timeoutMs, retryLimit: 0 }),
}) {
  assertHttpUrl(tokenUrl);
  if (typeof clientId !== 'string' || clientId.length === 0) {
    throw new TypeError('clientId must be a non-empty string');
  }
  if (typeof clientSecret !== 'string' || clientSecret.length === 0) {
    throw new TypeError('clientSecret must be a non-empty string');
  }
  if (scope !== undefined && (typeof scope !== 'string' || scope.length === 0)) {
    throw new TypeError('scope must be a non-empty string when provided');
  }

  /** @type {Record<string, string>} */
  const form = {
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  };
  if (scope) {
    form.scope = scope;
  }

  /** @type {unknown} */
  let body;
  try {
    body = await client.post(tokenUrl, { form }).json();
  } catch (error) {
    throw tokenRequestError(tokenUrl, error, [clientId, clientSecret]);
  }

  const record =
    body && typeof body === 'object' ? /** @type {Record<string, unknown>} */ (body) : {};
  const accessToken = record.access_token;
  const expiresIn = Number(record.expires_in);
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    throw new TypeError(`Token endpoint ${safeTokenUrl(tokenUrl)} did not return an access_token.`);
  }
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new TypeError(
      `Token endpoint ${safeTokenUrl(tokenUrl)} did not return a positive expires_in.`,
    );
  }

  return { accessToken, expiresIn };
}

/**
 * @param {string | import('../vault/secrets.js').VaultField | undefined} value
 * @returns {value is string}
 */
function isUrl(value) {
  return typeof value === 'string';
}

/**
 * @param {string | import('../vault/secrets.js').VaultField | undefined} value
 * @param {string} name
 * @param {Record<string, import('../vault/secrets.js').VaultField>} requests
 */
function addUrlField(value, name, requests) {
  if (isUrl(value)) {
    return;
  }
  if (
    !value ||
    typeof value !== 'object' ||
    typeof value.path !== 'string' ||
    typeof value.field !== 'string'
  ) {
    throw new TypeError(`${name} must be an absolute URL or a { path, field } Vault field`);
  }
  requests[name] = value;
}

/**
 * @param {string | import('../vault/secrets.js').VaultField} value
 * @param {Record<string, string>} secrets
 * @param {string} name
 * @returns {string}
 */
function resolveUrl(value, secrets, name) {
  const resolved = isUrl(value) ? value : secrets[name];
  try {
    assertHttpUrl(resolved);
  } catch (error) {
    if (!isUrl(value)) {
      throw new VaultError(`Vault field ${value.path} → ${value.field} is not an http(s) URL.`, {
        code: 'vault-missing-field',
        path: value.path,
        cause: error,
      });
    }
    throw error;
  }
  return resolved;
}

/**
 * Read the client id and secret from Vault, then return a token manager that
 * fetches and refreshes an access token. Vault is checked before this returns.
 * The token endpoint is called on the first `getAccessToken()`.
 *
 * `tokenUrl` may be an absolute URL, or a Vault field such as
 * `{ path: 'secret/reporting', field: 'token_url' }`.
 *
 * @param {object} options
 * @param {string | import('../vault/secrets.js').VaultField} options.tokenUrl
 * @param {import('../vault/secrets.js').VaultField} options.clientId
 * @param {import('../vault/secrets.js').VaultField} options.clientSecret
 * @param {string} [options.scope] `{clientId}` is replaced with the client id.
 * @param {number} [options.skewMs]
 * @param {number} [options.timeoutMs]
 * @param {Parameters<typeof readVaultValues>[1]} [options.vault]
 * @returns {Promise<import('./token-manager.js').TokenManager>}
 */
export async function createClientCredentialsFromVault({
  tokenUrl,
  clientId,
  clientSecret,
  scope,
  skewMs,
  timeoutMs,
  vault,
} = {}) {
  if (!clientId || !clientSecret) {
    throw new TypeError('clientId and clientSecret vault fields are required');
  }

  /** @type {Record<string, import('../vault/secrets.js').VaultField>} */
  const requests = { clientId, clientSecret };
  addUrlField(tokenUrl, 'tokenUrl', requests);

  const secrets = await readVaultValues(requests, vault);
  const resolvedTokenUrl = resolveUrl(tokenUrl, secrets, 'tokenUrl');

  return createTokenManager({
    skewMs,
    fetchToken() {
      return fetchClientCredentialsToken({
        tokenUrl: resolvedTokenUrl,
        clientId: secrets.clientId,
        clientSecret: secrets.clientSecret,
        scope: resolveScope(scope, secrets.clientId),
        timeoutMs,
      });
    },
  });
}

/**
 * Read the token endpoint, service base URL, and client credentials from Vault.
 * Pass a `{ path, field }` locator for each value that lives in Vault.
 * An absolute URL is also accepted for `tokenUrl` or `serviceUrl`.
 * The service URL becomes the HTTP client's `prefixUrl`.
 *
 * @param {object} options
 * @param {string | import('../vault/secrets.js').VaultField} options.tokenUrl
 * @param {string | import('../vault/secrets.js').VaultField} options.serviceUrl
 * @param {import('../vault/secrets.js').VaultField} options.clientId
 * @param {import('../vault/secrets.js').VaultField} options.clientSecret
 * @param {string} [options.scope] `{clientId}` is replaced with the client id.
 * @param {number} [options.skewMs]
 * @param {number} [options.timeoutMs]
 * @param {Parameters<typeof readVaultValues>[1]} [options.vault]
 * @returns {Promise<{ serviceUrl: string, client: import('got').Got }>}
 */
export async function createVaultServiceClient({
  tokenUrl,
  serviceUrl,
  clientId,
  clientSecret,
  scope,
  skewMs,
  timeoutMs,
  vault,
} = {}) {
  if (!clientId || !clientSecret) {
    throw new TypeError('clientId and clientSecret vault fields are required');
  }

  /** @type {Record<string, import('../vault/secrets.js').VaultField>} */
  const requests = { clientId, clientSecret };
  addUrlField(tokenUrl, 'tokenUrl', requests);
  addUrlField(serviceUrl, 'serviceUrl', requests);

  const secrets = await readVaultValues(requests, vault);
  const resolvedTokenUrl = resolveUrl(tokenUrl, secrets, 'tokenUrl');
  const resolvedServiceUrl = resolveUrl(serviceUrl, secrets, 'serviceUrl');
  const tokenManager = createTokenManager({
    skewMs,
    fetchToken() {
      return fetchClientCredentialsToken({
        tokenUrl: resolvedTokenUrl,
        clientId: secrets.clientId,
        clientSecret: secrets.clientSecret,
        scope: resolveScope(scope, secrets.clientId),
        timeoutMs,
      });
    },
  });

  return {
    serviceUrl: resolvedServiceUrl,
    client: createHttpClient({
      prefixUrl: resolvedServiceUrl,
      tokenManager,
      timeoutMs,
    }),
  };
}
