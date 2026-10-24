# Project layout

- Shared helpers live in `src/` and are exported from `src/index.js`. Committed examples live in `scripts/`.
- Task scripts live in `work/`. That directory is gitignored. Do not commit it, and do not copy its Vault paths or URLs into the repo.
- Read secrets with `readVaultValues` or `createVaultServiceClient`. Errors may name paths and fields. Do not print secret values, access tokens, or client secrets.
- A script passes Vault locators such as `{ path, field }` for `tokenUrl`, `serviceUrl`, `clientId`, and `clientSecret`. Call `requireVaultField(locator, name)` to reject a blank locator before reading Vault.
- For the Microsoft Entra v2 token endpoint, pass `scope: '{clientId}/.default'` unless that script needs a different resource. `{clientId}` is replaced with the client id read from Vault.
- Paths passed to the HTTP client are appended to the service URL and must not start with `/`.

# JavaScript Style

- Add JSDoc where it clarifies a public API, exported symbol, callback contract, object shape, or non-obvious type. Keep it accurate when code changes.
- Do not add narrative, section, restatement, or implementation comments. Use clear names and small functions instead.
- `TODO` comments are allowed for concrete follow-up work. Other comments require a specific reason that cannot be expressed clearly in code or JSDoc.
- Prefer named function declarations for reusable functions.
- Use an arrow function only when it produces less code without reducing clarity, such as a short inline callback.
- Prefer `async`/`await` to `.then()`, `.catch()`, or `.finally()` chains when both approaches are practical.
- Always put braces around `if`, `else`, loops, and other control-flow bodies, including one-line bodies.
- Never use nested ternary expressions. Use `if`/`else` or extract a function.
- Let ESLint and Prettier handle conventions they can enforce. Do not manually format code against their output or duplicate their rules here.
