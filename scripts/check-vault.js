import { assertVaultReady, listVaultFields, readVaultValues, VaultError } from '../src/index.js';

const args = process.argv.slice(2);

try {
  if (args.length === 0) {
    await assertVaultReady();
    console.log('Vault CLI is installed and this session can use it.');
  } else {
    /** @type {Record<string, { path: string, field: string }>} */
    const fields = {};
    /** @type {string[]} */
    const paths = [];

    for (const arg of args) {
      const separator = arg.indexOf('#');
      if (separator === -1) {
        paths.push(arg);
        continue;
      }
      fields[arg] = { path: arg.slice(0, separator), field: arg.slice(separator + 1) };
    }

    for (const path of paths) {
      const names = await listVaultFields(path);
      console.log(`${path} is readable. Fields: ${names.join(', ') || '(none)'}`);
    }

    if (Object.keys(fields).length > 0) {
      await readVaultValues(fields);
      for (const name of Object.keys(fields)) {
        console.log(`${name} is present.`);
      }
    }
  }
} catch (error) {
  if (error instanceof VaultError) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
}
