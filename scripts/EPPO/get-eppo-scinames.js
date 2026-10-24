import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import cliProgress from 'cli-progress';
import {
  loadEnvFile,
  promptForSavePath,
  promptForTabularInput,
  writeWorkbook,
} from '../../src/index.js';
import { createEppoClient } from '../../src/eppo/client.js';
import { normalizeCell, resolveScinameRow } from '../../src/eppo/resolve-scinames.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const REQUIRED_COLUMNS = ['Provided EPPO Code', 'Provided Sciname'];

/**
 * @param {Date} [when]
 * @returns {string}
 */
function datedOutputDefault(when = new Date()) {
  const month = String(when.getMonth() + 1).padStart(2, '0');
  const day = String(when.getDate()).padStart(2, '0');
  const year = String(when.getFullYear()).slice(-2);
  return join('llm-scratch', `output_${month}${day}${year}.xlsx`);
}

/**
 * @param {{ getTaxonOverview: Function, nameToCodes: Function }} client
 * @param {Record<string, unknown>[]} rows
 */
async function resolveRows(client, rows) {
  /** @type {import('../../src/eppo/resolve-scinames.js').ScinameOutputRow[]} */
  const output = [];
  const workRows = rows.filter((row) => {
    return (
      normalizeCell(row['Provided EPPO Code']) != null ||
      normalizeCell(row['Provided Sciname']) != null
    );
  });

  const progress = new cliProgress.SingleBar(
    {
      format: 'EPPO lookup |{bar}| {percentage}% | {value}/{total} rows | ETA {eta_formatted}',
      hideCursor: true,
      clearOnComplete: false,
      stopOnComplete: true,
    },
    cliProgress.Presets.shades_classic,
  );
  progress.start(workRows.length, 0);

  try {
    for (const row of workRows) {
      const providedCode = normalizeCell(row['Provided EPPO Code']);
      const providedSciname = normalizeCell(row['Provided Sciname']);

      const codeOverview = providedCode ? await client.getTaxonOverview(providedCode) : undefined;
      const nameMatches = providedSciname ? await client.nameToCodes(providedSciname) : [];
      /** @type {Map<string, import('../../src/eppo/client.js').EppoTaxonOverview | null>} */
      const overviewsByCode = new Map();
      const codesToFetch = new Set(nameMatches.map((match) => match.eppocode).filter(Boolean));
      if (providedCode) {
        codesToFetch.delete(providedCode);
      }

      for (const code of codesToFetch) {
        overviewsByCode.set(code, await client.getTaxonOverview(code));
      }

      output.push(
        ...resolveScinameRow(
          {
            providedCode: providedCode ?? undefined,
            providedSciname: providedSciname ?? undefined,
          },
          { codeOverview, nameMatches, overviewsByCode },
        ),
      );
      progress.increment();
    }
  } finally {
    progress.stop();
  }

  return output;
}

loadEnvFile(join(repoRoot, '.env'));

const input = await promptForTabularInput({
  requiredColumns: REQUIRED_COLUMNS,
  defaultPath: join('llm-scratch', 'input.csv'),
  message: 'Enter input CSV or Excel (.xlsx) path',
  cwd: repoRoot,
});

console.log(`Read ${input.rows.length} data row(s) from ${input.path}`);

const outputPath = await promptForSavePath({
  defaultPath: datedOutputDefault(),
  message: 'Enter Excel (.xlsx) output path',
  cwd: repoRoot,
});

const client = createEppoClient();
const resolved = await resolveRows(client, input.rows);

await writeWorkbook(outputPath, [
  {
    name: 'Results',
    columns: [
      { header: 'Provided EPPO Code', key: 'providedCode', width: 20 },
      { header: 'Provided Sciname', key: 'providedSciname', width: 28 },
      { header: 'EPPO Preferred Sciname', key: 'preferredSciname', width: 40 },
      { header: 'Note', key: 'note', width: 72 },
    ],
    rows: resolved.map((row) => ({
      providedCode: row.providedCode,
      providedSciname: row.providedSciname,
      preferredSciname: row.preferredSciname,
      note: row.note,
    })),
  },
]);

console.log(`Wrote ${resolved.length} result row(s) to ${outputPath}`);
