import { jest } from '@jest/globals';
import { createHttpClient } from '../../src/http/client.js';
import { createTokenManager } from '../../src/http/token-manager.js';
import { listen } from '../helpers/listen.js';

/**
 * @param {import('node:http').ServerResponse} response
 * @param {number} status
 * @param {unknown} body
 */
function sendJson(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

describe('createHttpClient', () => {
  /** @type {Awaited<ReturnType<typeof listen>> | undefined} */
  let server;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('sends the cached bearer token', async () => {
    /** @type {string | undefined} */
    let authorization;
    server = await listen((request, response) => {
      authorization = request.headers.authorization;
      sendJson(response, 200, { ok: true });
    });

    const fetchToken = jest.fn(async () => ({ accessToken: 'fresh-token', expiresIn: 3600 }));
    const client = createHttpClient({
      prefixUrl: server.url,
      tokenManager: createTokenManager({ fetchToken, now: () => 0 }),
    });

    await expect(client.get('status').json()).resolves.toEqual({ ok: true });
    expect(authorization).toBe('Bearer fresh-token');
    expect(fetchToken).toHaveBeenCalledTimes(1);
  });

  it('refreshes a token that is about to expire before the request is sent', async () => {
    /** @type {string | undefined} */
    let authorization;
    server = await listen((request, response) => {
      authorization = request.headers.authorization;
      sendJson(response, 200, { ok: true });
    });

    let clock = 0;
    const fetchToken = jest
      .fn()
      .mockResolvedValueOnce({ accessToken: 'stale', expiresIn: 30 })
      .mockResolvedValueOnce({ accessToken: 'renewed', expiresIn: 3600 });
    const tokenManager = createTokenManager({ fetchToken, skewMs: 60_000, now: () => clock });
    await tokenManager.getAccessToken();
    clock = 1_000;

    const client = createHttpClient({ prefixUrl: server.url, tokenManager });
    await client.get('status').json();

    expect(authorization).toBe('Bearer renewed');
    expect(fetchToken).toHaveBeenCalledTimes(2);
  });

  it('refreshes once and retries after a 401', async () => {
    let attempts = 0;
    /** @type {string[]} */
    const authorizations = [];
    server = await listen((request, response) => {
      attempts += 1;
      authorizations.push(String(request.headers.authorization));
      if (attempts === 1) {
        sendJson(response, 401, { error: 'expired' });
        return;
      }
      sendJson(response, 200, { ok: true });
    });

    const fetchToken = jest
      .fn()
      .mockResolvedValueOnce({ accessToken: 'expired', expiresIn: 3600 })
      .mockResolvedValueOnce({ accessToken: 'renewed', expiresIn: 3600 });
    const client = createHttpClient({
      prefixUrl: server.url,
      tokenManager: createTokenManager({ fetchToken, now: () => 0 }),
    });

    await expect(client.get('reports').json()).resolves.toEqual({ ok: true });
    expect(authorizations).toEqual(['Bearer expired', 'Bearer renewed']);
    expect(fetchToken).toHaveBeenCalledTimes(2);
  });

  it('does not refresh forever when the retry is still unauthorized', async () => {
    let attempts = 0;
    server = await listen((request, response) => {
      attempts += 1;
      sendJson(response, 401, { error: 'nope' });
    });

    const fetchToken = jest.fn(async () => ({ accessToken: `token-${attempts}`, expiresIn: 3600 }));
    const client = createHttpClient({
      prefixUrl: server.url,
      retryLimit: 0,
      tokenManager: createTokenManager({ fetchToken, now: () => 0 }),
    });

    await expect(client.get('reports').json()).rejects.toMatchObject({
      response: { statusCode: 401 },
    });
    expect(attempts).toBe(2);
    expect(fetchToken).toHaveBeenCalledTimes(2);
  });

  it('retries a 503 and then returns the successful body', async () => {
    let attempts = 0;
    server = await listen((request, response) => {
      attempts += 1;
      if (attempts === 1) {
        sendJson(response, 503, { error: 'busy' });
        return;
      }
      sendJson(response, 200, { ok: true });
    });

    const client = createHttpClient({
      prefixUrl: server.url,
      gotOptions: { retry: { calculateDelay: () => 1 } },
    });

    await expect(client.get('reports').json()).resolves.toEqual({ ok: true });
    expect(attempts).toBe(2);
  });

  it('fails when the request exceeds the timeout', async () => {
    server = await listen(() => {});
    const client = createHttpClient({
      prefixUrl: server.url,
      timeoutMs: 50,
      retryLimit: 0,
    });

    await expect(client.get('slow').text()).rejects.toMatchObject({
      name: 'TimeoutError',
      code: 'ETIMEDOUT',
    });
  });
});
