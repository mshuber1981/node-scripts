import { writeWorkbook } from '../src/index.js';

const destination = process.argv[2] ?? 'output/report.xlsx';

await writeWorkbook(destination, [
  {
    name: 'Summary',
    columns: [
      { header: 'Name', key: 'name', width: 24 },
      { header: 'Count', key: 'count', width: 12 },
    ],
    rows: [
      { name: 'Alpha', count: 3 },
      { name: 'Beta', count: 8 },
    ],
  },
]);

console.log(`Wrote ${destination}`);
