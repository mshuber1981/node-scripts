# node-scripts

Scripts that fetch data and write Excel reports, or read a report and use the rows to create or update something else.

The package is ESM (`import` / `export`) and targets Node 22 or newer.

## Setup

```bash
npm install
npm test
npm run check
```

`check` runs Prettier, ESLint, and Jest. Pull requests and pushes to `main` run that same check in GitHub Actions, plus `npm audit` for high and critical findings.

| Script                   | Purpose                                        |
| ------------------------ | ---------------------------------------------- |
| `npm test`               | Unit tests                                     |
| `npm run test:watch`     | Jest in watch mode                             |
| `npm run lint`           | ESLint                                         |
| `npm run format`         | Prettier write                                 |
| `npm run format:check`   | Prettier check                                 |
| `npm run example:report` | Write `output/report.xlsx`                     |
| `npm run check:vault`    | Confirm Vault, or read paths passed after `--` |

Shared helpers live in `src/`. Scripts that should be committed live in `scripts/`. Scripts for a specific task live in `work/`, which Git ignores. Each work script names the Vault fields it needs. `node work/fetch.js` is a local starting point.

## Vault

Secrets come from the `vault` CLI. `readVaultValues` checks three things before it returns, and throws a `VaultError` at the first failure:

1. The `vault` binary is on `PATH`.
2. `vault token lookup` succeeds for this session.
3. Each requested path can be read, and each requested field is present.

The same path is read once when several fields come from it. Errors name the path and the field. They do not print secret values.

```bash
npm run check:vault
npm run check:vault -- secret/reporting
npm run check:vault -- secret/reporting#client_id secret/reporting#client_secret
```

The first command only checks the CLI and the login. A path checks that the secret is readable and prints its field names. `path#field` checks that one field exists. Nothing prints the values.

## HTTP

[`got`](https://github.com/sindresorhus/got) does the requests. Timeouts and retries are on by default: 10 seconds, then two more attempts for network errors, timeouts, and status codes such as 408, 429, and 500–504. POST is left alone unless a script opts in, because a retried write may not be safe.

Client credentials are read from Vault, then exchanged at a token endpoint with `grant_type=client_credentials`. The token is cached and refreshed when it is within 60 seconds of expiry. A later `401` refreshes once and sends the request again.

A script supplies the Vault field for each value it needs. The token URL can stay the same across scripts, but it still comes from Vault rather than from this repo. Another script can point `clientId`, `clientSecret`, and `serviceUrl` at different fields.

```js
import { createVaultServiceClient } from '../src/index.js';

const { client } = await createVaultServiceClient({
  tokenUrl: { path: 'secret/shared', field: 'token_url' },
  serviceUrl: { path: 'secret/services', field: 'reporting' },
  clientId: { path: 'secret/reporting', field: 'client_id' },
  clientSecret: { path: 'secret/reporting', field: 'client_secret' },
  scope: '{clientId}/.default',
});

const reports = await client.get('reports').json();
```

Those fields are read before the client is returned. The token endpoint is called on the first request. Fields that share a Vault path are read once.

Paths appended to `prefixUrl` do not start with `/`. Override `timeoutMs`, `retryLimit`, or pass `gotOptions` when a script needs a different policy. Other grants can still use `createTokenManager({ fetchToken })`.

## Excel

[`exceljs`](https://github.com/exceljs/exceljs) reads and writes workbooks. `writeWorkbook` creates parent directories, freezes the header row, and turns on a filter. A cell value of `{ text, hyperlink }` is stored as a link and shown in blue with an underline. `readSheet` returns row objects keyed by the header text, uses the display text for link cells, and skips blank rows.

```js
import { readSheet, writeWorkbook } from '../src/index.js';

await writeWorkbook('output/report.xlsx', [
  {
    name: 'Summary',
    columns: [
      { header: 'Name', key: 'name', width: 24 },
      { header: 'Count', key: 'count', width: 12 },
    ],
    rows: [{ name: 'Alpha', count: 3 }],
  },
]);

const rows = await readSheet('output/report.xlsx', { sheet: 'Summary' });
```

`npm run example:report` writes a sample file to `output/report.xlsx`.
