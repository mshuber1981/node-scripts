import got from 'got';

/**
 * HTTP client with a request timeout, retries, and optional bearer-token refresh.
 *
 * Retries use got's defaults: network errors, timeouts, and retryable status
 * codes such as 408, 429, and 500–504. POST is not retried unless you opt in
 * through `gotOptions.retry`. A 401 is handled separately: the token is
 * refreshed once and the request is sent again.
 *
 * @param {object} [options]
 * @param {string} [options.prefixUrl] Base URL. Request paths are appended to it and must not start with `/`.
 * @param {number} [options.timeoutMs] Whole-request timeout in milliseconds. Defaults to 10 seconds.
 * @param {number} [options.retryLimit] Extra attempts after the first failure. Defaults to 2.
 * @param {import('./token-manager.js').TokenManager} [options.tokenManager]
 * @param {import('got').ExtendOptions} [options.gotOptions] Additional got options. Nested `retry`, `timeout`, and `hooks` are merged.
 * @returns {typeof got}
 */
export function createHttpClient({
  prefixUrl,
  timeoutMs = 10_000,
  retryLimit = 2,
  tokenManager,
  gotOptions = {},
} = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('timeoutMs must be a positive number');
  }
  if (!Number.isInteger(retryLimit) || retryLimit < 0) {
    throw new TypeError('retryLimit must be a non-negative integer');
  }
  if (
    tokenManager &&
    (typeof tokenManager.getAccessToken !== 'function' ||
      typeof tokenManager.forceRefresh !== 'function')
  ) {
    throw new TypeError('tokenManager must provide getAccessToken and forceRefresh');
  }

  const userHooks = gotOptions.hooks ?? {};
  /** @type {import('got').Hooks} */
  const hooks = { ...userHooks };

  if (tokenManager) {
    hooks.beforeRequest = [
      ...(userHooks.beforeRequest ?? []),
      async (options) => {
        const accessToken = await tokenManager.getAccessToken();
        options.headers.authorization = `Bearer ${accessToken}`;
      },
    ];

    hooks.afterResponse = [
      ...(userHooks.afterResponse ?? []),
      async (response, retryWithMergedOptions) => {
        if (response.statusCode !== 401 || response.request.options.context.authRetried) {
          return response;
        }

        const accessToken = await tokenManager.forceRefresh();
        return retryWithMergedOptions({
          headers: {
            authorization: `Bearer ${accessToken}`,
          },
          context: {
            ...response.request.options.context,
            authRetried: true,
          },
        });
      },
    ];
  }

  return got.extend({
    ...gotOptions,
    ...(prefixUrl ? { prefixUrl } : {}),
    timeout: {
      ...gotOptions.timeout,
      request: timeoutMs,
    },
    retry: {
      limit: retryLimit,
      ...gotOptions.retry,
    },
    hooks,
  });
}
