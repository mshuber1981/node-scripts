import {
  createClientCredentialsFromVault,
  createVaultServiceClient,
  fetchClientCredentialsToken,
} from '../../src/http/client-credentials.js';
import { VaultCommandError } from '../../src/vault/secrets.js';
import { listen } from '../helpers/listen.js';

/**
 * @param {import('node:http').IncomingMessage} request
 * @returns {Promise<string>}
 */
function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

/**
 * @param {Record<string, string>} fields
 */
function kv2(fields) {
  return { data: { data: fields, metadata: { version: 1 } } };
}

/**
 * @param {Record<string, object>} secrets
 */
function vaultRun(secrets) {
  /** @type {string[][]} */
  const calls = [];
  return {
    calls,
    /**
     * @param {string[]} args
     */
    async run(args) {
      calls.push(args);
      if (args[0] === 'version' || args[0] === 'token') {
        return { stdout: '{}\n', stderr: '' };
      }
      const path = args.at(-1);
      return { stdout: JSON.stringify(secrets[path]), stderr: '' };
    },
  };
}

describe('fetchClientCredentialsToken', () => {
  /** @type {Awaited<ReturnType<typeof listen>> | undefined} */
  let server;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('posts the client credentials form and returns the access token', async () => {
    /** @type {string | undefined} */
    let rawBody;
    /** @type {string | undefined} */
    let contentType;
    server = await listen(async (request, response) => {
      contentType = request.headers['content-type'];
      rawBody = await readBody(request);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ access_token: 'issued-token', expires_in: '120' }));
    });

    await expect(
      fetchClientCredentialsToken({
        tokenUrl: `${server.url}/oauth/token`,
        clientId: 'client-123',
        clientSecret: 'secret-456',
        scope: 'reports.read',
      }),
    ).resolves.toEqual({ accessToken: 'issued-token', expiresIn: 120 });

    const body = new URLSearchParams(rawBody);
    expect(contentType).toContain('application/x-www-form-urlencoded');
    expect(body.get('grant_type')).toBe('client_credentials');
    expect(body.get('client_id')).toBe('client-123');
    expect(body.get('client_secret')).toBe('secret-456');
    expect(body.get('scope')).toBe('reports.read');
    expect(new URL(`${server.url}/oauth/token`).search).toBe('');
  });

  it('reports the status code without the response body', async () => {
    server = await listen((request, response) => {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          error: 'invalid_client',
          error_description: 'rejected secret-456',
          detail: 'super-secret',
        }),
      );
    });

    let error;
    try {
      await fetchClientCredentialsToken({
        tokenUrl: `${server.url}/oauth/token?debug=super-secret`,
        clientId: 'client-123',
        clientSecret: 'secret-456',
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('failed with status 401');
    expect(error.message).toContain('invalid_client');
    expect(error.message).toContain('rejected [redacted]');
    expect(error.message).not.toContain('secret-456');
    expect(error.message).not.toContain('super-secret');
  });

  it('rejects a token response that has no access token without echoing the body', async () => {
    server = await listen((request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ debug: 'super-secret' }));
    });

    await expect(
      fetchClientCredentialsToken({
        tokenUrl: `${server.url}/oauth/token`,
        clientId: 'client-123',
        clientSecret: 'secret-456',
      }),
    ).rejects.toThrow(/did not return an access_token/);
  });
});

describe('createClientCredentialsFromVault', () => {
  /** @type {Awaited<ReturnType<typeof listen>> | undefined} */
  let server;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('reads Vault before requesting a token', async () => {
    /** @type {string | undefined} */
    let rawBody;
    server = await listen(async (request, response) => {
      rawBody = await readBody(request);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ access_token: 'issued-token', expires_in: 3600 }));
    });
    const vault = vaultRun({
      'secret/reporting': kv2({
        client_id: 'client-123',
        client_secret: 'secret-456',
        token_url: `${server.url}/oauth/token`,
      }),
    });

    const tokens = await createClientCredentialsFromVault({
      tokenUrl: { path: 'secret/reporting', field: 'token_url' },
      clientId: { path: 'secret/reporting', field: 'client_id' },
      clientSecret: { path: 'secret/reporting', field: 'client_secret' },
      vault,
    });

    expect(vault.calls.some((args) => args[0] === 'kv')).toBe(true);
    expect(rawBody).toBeUndefined();

    await expect(tokens.getAccessToken()).resolves.toBe('issued-token');
    const body = new URLSearchParams(rawBody);
    expect(body.get('client_id')).toBe('client-123');
    expect(body.get('client_secret')).toBe('secret-456');
    expect(vault.calls.filter((args) => args[0] === 'kv')).toHaveLength(1);
  });

  it('does not call the token endpoint when Vault cannot be read', async () => {
    const requests = [];
    server = await listen((request, response) => {
      requests.push(request.url);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{}');
    });
    const vault = {
      /**
       * @param {string[]} args
       */
      async run(args) {
        if (args[0] === 'kv') {
          throw new VaultCommandError('denied', {
            args,
            code: 2,
            stderr: 'permission denied',
            killed: false,
          });
        }
        return { stdout: '{}\n', stderr: '' };
      },
    };

    await expect(
      createClientCredentialsFromVault({
        tokenUrl: `${server.url}/oauth/token`,
        clientId: { path: 'secret/reporting', field: 'client_id' },
        clientSecret: { path: 'secret/reporting', field: 'client_secret' },
        vault,
      }),
    ).rejects.toThrow(/permission denied/);
    expect(requests).toEqual([]);
  });
});

describe('createVaultServiceClient', () => {
  /** @type {Awaited<ReturnType<typeof listen>> | undefined} */
  let server;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('stops before Vault when the token URL field is missing', async () => {
    /** @type {string[][]} */
    const calls = [];

    await expect(
      createVaultServiceClient({
        serviceUrl: { path: 'secret/reporting', field: 'base_url' },
        clientId: { path: 'secret/reporting', field: 'client_id' },
        clientSecret: { path: 'secret/reporting', field: 'client_secret' },
        vault: {
          async run(args) {
            calls.push(args);
            return { stdout: '{}\n', stderr: '' };
          },
        },
      }),
    ).rejects.toThrow('tokenUrl must be an absolute URL or a { path, field } Vault field');
    expect(calls).toEqual([]);
  });

  it('reads the token URL and service URL from Vault', async () => {
    /** @type {string | undefined} */
    let requestPath;
    /** @type {string | undefined} */
    let authorization;
    /** @type {string | undefined} */
    let rawBody;
    server = await listen(async (request, response) => {
      if (request.url === '/oauth/token') {
        rawBody = await readBody(request);
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ access_token: 'issued-token', expires_in: 3600 }));
        return;
      }
      requestPath = request.url;
      authorization = request.headers.authorization;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true }));
    });
    const vault = vaultRun({
      'secret/reporting': kv2({
        client_id: 'client-123',
        client_secret: 'secret-456',
        token_url: `${server.url}/oauth/token`,
        base_url: server.url,
      }),
    });

    const { client, serviceUrl } = await createVaultServiceClient({
      tokenUrl: { path: 'secret/reporting', field: 'token_url' },
      serviceUrl: { path: 'secret/reporting', field: 'base_url' },
      clientId: { path: 'secret/reporting', field: 'client_id' },
      clientSecret: { path: 'secret/reporting', field: 'client_secret' },
      scope: '{clientId}/.default',
      vault,
    });

    expect(serviceUrl).toBe(server.url);
    await expect(client.get('status').json()).resolves.toEqual({ ok: true });
    expect(requestPath).toBe('/status');
    expect(authorization).toBe('Bearer issued-token');
    const body = new URLSearchParams(rawBody);
    expect(body.get('client_id')).toBe('client-123');
    expect(body.get('client_secret')).toBe('secret-456');
    expect(body.get('scope')).toBe('client-123/.default');
    expect(vault.calls.filter((args) => args[0] === 'kv')).toHaveLength(1);
  });

  it('does not include a non-URL service value in the error', async () => {
    const vault = vaultRun({
      'secret/reporting': kv2({
        client_id: 'client-123',
        client_secret: 'secret-456',
        token_url: 'https://auth.example.com/oauth/token',
        base_url: 'super-secret',
      }),
    });

    let error;
    try {
      await createVaultServiceClient({
        tokenUrl: { path: 'secret/reporting', field: 'token_url' },
        serviceUrl: { path: 'secret/reporting', field: 'base_url' },
        clientId: { path: 'secret/reporting', field: 'client_id' },
        clientSecret: { path: 'secret/reporting', field: 'client_secret' },
        vault,
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('is not an http(s) URL');
    expect(error.message).not.toContain('super-secret');
  });
});
