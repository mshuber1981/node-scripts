/**
 * @typedef {object} AccessToken
 * @property {string} accessToken
 * @property {number | Date} [expiresAt] Absolute expiry. Numbers are milliseconds since the epoch.
 * @property {number} [expiresIn] Lifetime in seconds. Used when `expiresAt` is omitted.
 */

/**
 * @typedef {object} TokenManager
 * @property {() => Promise<string>} getAccessToken Cached token, refreshed when it is inside the skew window.
 * @property {() => Promise<string>} forceRefresh New token, even if the cached one is still fresh.
 */

/**
 * Keep one access token in memory and refresh it shortly before it expires.
 * Concurrent callers share a single in-flight fetch.
 *
 * `fetchToken` should return a token that stays valid longer than `skewMs`.
 * Client credentials from Vault use `createClientCredentialsFromVault`.
 * Any other grant can pass its own `fetchToken`.
 *
 * @param {object} options
 * @param {() => Promise<AccessToken>} options.fetchToken
 * @param {number} [options.skewMs] Refresh this many milliseconds before expiry. Defaults to 60 seconds.
 * @param {() => number} [options.now] Clock override, used by tests.
 * @returns {TokenManager}
 */
export function createTokenManager({ fetchToken, skewMs = 60_000, now = Date.now } = {}) {
  if (typeof fetchToken !== 'function') {
    throw new TypeError('fetchToken is required');
  }
  if (!Number.isFinite(skewMs) || skewMs < 0) {
    throw new TypeError('skewMs must be a non-negative number');
  }

  /** @type {{ accessToken: string, expiresAt: number } | null} */
  let current = null;
  /** @type {Promise<string> | null} */
  let inflight = null;

  /**
   * @param {AccessToken} token
   * @param {number} timestamp
   * @returns {number}
   */
  function resolveExpiresAt(token, timestamp) {
    if (token.expiresAt instanceof Date) {
      const expiresAt = token.expiresAt.getTime();
      if (Number.isNaN(expiresAt)) {
        throw new TypeError('expiresAt is an invalid date');
      }
      return expiresAt;
    }
    if (typeof token.expiresAt === 'number' && Number.isFinite(token.expiresAt)) {
      return token.expiresAt;
    }
    if (typeof token.expiresIn === 'number' && Number.isFinite(token.expiresIn)) {
      return timestamp + token.expiresIn * 1000;
    }
    throw new TypeError('fetchToken must include expiresAt or expiresIn');
  }

  async function requestToken() {
    const token = await fetchToken();
    if (!token || typeof token.accessToken !== 'string' || token.accessToken.length === 0) {
      throw new TypeError('fetchToken must resolve to an accessToken string');
    }
    const timestamp = now();
    current = {
      accessToken: token.accessToken,
      expiresAt: resolveExpiresAt(token, timestamp),
    };
    return current.accessToken;
  }

  function isFresh() {
    return current !== null && current.expiresAt - skewMs > now();
  }

  async function refresh() {
    try {
      return await requestToken();
    } finally {
      inflight = null;
    }
  }

  /**
   * @param {boolean} force
   * @returns {Promise<string>}
   */
  async function load(force) {
    if (!force && isFresh()) {
      return current.accessToken;
    }
    if (!inflight) {
      inflight = refresh();
    }
    return inflight;
  }

  return {
    getAccessToken() {
      return load(false);
    },
    forceRefresh() {
      return load(true);
    },
  };
}
