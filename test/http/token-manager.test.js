import { jest } from '@jest/globals';
import { createTokenManager } from '../../src/http/token-manager.js';

describe('createTokenManager', () => {
  it('requires fetchToken', () => {
    expect(() => createTokenManager()).toThrow('fetchToken is required');
  });

  it('rejects a negative skew', () => {
    expect(() =>
      createTokenManager({ fetchToken: async () => ({ accessToken: 'a' }), skewMs: -1 }),
    ).toThrow('skewMs must be a non-negative number');
  });

  it('returns a cached token until it enters the refresh window', async () => {
    let clock = 1_000;
    const fetchToken = jest.fn(async () => ({ accessToken: 'first', expiresAt: 120_000 }));
    const tokens = createTokenManager({ fetchToken, skewMs: 60_000, now: () => clock });

    await expect(tokens.getAccessToken()).resolves.toBe('first');
    clock = 50_000;
    await expect(tokens.getAccessToken()).resolves.toBe('first');
    expect(fetchToken).toHaveBeenCalledTimes(1);
  });

  it('refreshes once the token is inside the skew window', async () => {
    let clock = 0;
    const fetchToken = jest
      .fn()
      .mockResolvedValueOnce({ accessToken: 'first', expiresIn: 120 })
      .mockResolvedValueOnce({ accessToken: 'second', expiresAt: new Date(1_000_000) });
    const tokens = createTokenManager({ fetchToken, skewMs: 60_000, now: () => clock });

    await expect(tokens.getAccessToken()).resolves.toBe('first');
    clock = 70_000;
    await expect(tokens.getAccessToken()).resolves.toBe('second');
    expect(fetchToken).toHaveBeenCalledTimes(2);
  });

  it('shares one fetch between concurrent callers', async () => {
    /** @type {(token: { accessToken: string, expiresAt: number }) => void} */
    let completeFetch;
    const fetchToken = jest.fn(
      () =>
        new Promise((resolve) => {
          completeFetch = resolve;
        }),
    );
    const tokens = createTokenManager({ fetchToken, now: () => 0 });

    const first = tokens.getAccessToken();
    const second = tokens.getAccessToken();
    expect(fetchToken).toHaveBeenCalledTimes(1);

    completeFetch({ accessToken: 'shared', expiresAt: 1_000_000 });
    await expect(first).resolves.toBe('shared');
    await expect(second).resolves.toBe('shared');
  });

  it('forces a new token even when the cache is fresh', async () => {
    const fetchToken = jest
      .fn()
      .mockResolvedValueOnce({ accessToken: 'first', expiresIn: 3600 })
      .mockResolvedValueOnce({ accessToken: 'second', expiresIn: 3600 });
    const tokens = createTokenManager({ fetchToken, now: () => 0 });

    await tokens.getAccessToken();
    await expect(tokens.forceRefresh()).resolves.toBe('second');
    expect(fetchToken).toHaveBeenCalledTimes(2);
  });

  it('does not cache a failed fetch', async () => {
    const fetchToken = jest
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ accessToken: 'recovered', expiresIn: 3600 });
    const tokens = createTokenManager({ fetchToken, now: () => 0 });

    await expect(tokens.getAccessToken()).rejects.toThrow('network');
    await expect(tokens.getAccessToken()).resolves.toBe('recovered');
  });

  it('rejects a token that has no expiry', async () => {
    const tokens = createTokenManager({
      fetchToken: async () => ({ accessToken: 'no-expiry' }),
      now: () => 0,
    });

    await expect(tokens.getAccessToken()).rejects.toThrow('expiresAt or expiresIn');
  });
});
