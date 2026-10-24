# EPPO scripts

Scripts that call the [EPPO Global Database API](https://data.eppo.int/apis/GDAPI) (GDAPI) to look up taxa by EPPO code and/or scientific name, then write Excel reports.

API docs and OpenAPI: [data.eppo.int/apis/GDAPI](https://data.eppo.int/apis/GDAPI) · [OpenAPI YAML](https://api.eppo.int/gd/v2/eppo_api_gd_v2.yml)  
Endpoint map and deeper API notes: [EPPO_Data_Services.md](./EPPO_Data_Services.md)

## API key

1. Create an account / sign in at [data.eppo.int](https://data.eppo.int).
2. Open the dashboard and generate an API key.
3. Put it in the repo-root `.env` (gitignored):

```bash
EPPO_KEY=your-key-here
```

The client sends that value as the `X-Api-Key` header. Do not commit `.env` or paste keys into scripts or PRs.

## Rate limiting

Per EPPO’s API description (effective 2026-05-22):

- At most **2000 requests per IP** in a **10-second sliding window**
- Parallel requests are allowed if you stay under the limit
- Exceeding the limit returns **HTTP 429**

These scripts process input rows **sequentially**. Each row can trigger more than one request (code overview, name lookup, and any extra codes from a name match), so large files are mostly limited by network latency, not by the 2000/10s cap. Expect a progress bar and a longer run for big inputs. If you ever see 429s, wait and retry; the HTTP client already retries some transient failures.

## Scripts

### `get-eppo-scinames.js`

Resolves optional **Provided EPPO Code** and/or **Provided Sciname** columns against EPPO and writes an Excel report.

**Run** (from the repo root, after `npm install`):

```bash
npm run eppo:scinames
# or
node scripts/EPPO/get-eppo-scinames.js
```

You will be prompted for:

| Prompt               | Default                                                                  |
| -------------------- | ------------------------------------------------------------------------ |
| Input CSV or `.xlsx` | `llm-scratch/input.csv`                                                  |
| Output `.xlsx`       | `llm-scratch/output_MMDDYY.xlsx` (local date, e.g. `output_102426.xlsx`) |

**Required input headers** (exact names):

- `Provided EPPO Code`
- `Provided Sciname`

Either cell may be blank on a given row (not both).

**Example input**

| Provided EPPO Code | Provided Sciname  |
| ------------------ | ----------------- |
| BEAVA              | Some wrong name   |
| RHIZCE             | Cercospora sorghi |
|                    | Ustilago avenae   |
| ALSOR              |                   |
| XYZ                |                   |
|                    | 123               |
| ABC                | 321               |

**Example output**

| Provided EPPO Code | Provided Sciname  | EPPO Preferred Sciname                       | Note                                                                                 |
| ------------------ | ----------------- | -------------------------------------------- | ------------------------------------------------------------------------------------ |
| BEAVA              | Some wrong name   | Beta vulgaris subsp. vulgaris var. altissima | Provided Sciname not found                                                           |
| RHIZCE             | Cercospora sorghi | Rhizoctonia cerealis                         | Provided Sciname referred to a different EPPO code resulting in one or more new rows |
| CERCSG             | Cercospora sorghi | Cercospora sorghi                            | New row                                                                              |
| USTIAV             | Ustilago avenae   | Ustilago avenae                              |                                                                                      |
| ALSOR              |                   | Alisma orientale                             | This code has been deactivated and replaced by ALSPO (hyperlink to the taxon page)   |
| XYZ                |                   |                                              | Sorry, no results found for EPPO code                                                |
|                    | 123               |                                              | Sorry, no results found for provided Sciname                                         |
| ABC                | 321               |                                              | Sorry, no results found                                                              |

Behavior in short:

- Code and/or name are looked up in EPPO
- If a provided name maps to a **different** EPPO code than the one supplied, the original row is kept and an extra **New row** is added for the name’s code
- Deactivated codes get a Note with a link to `https://gd.eppo.int/taxon/{CODE}` (and the replacement code when EPPO provides one)
- Missing / invalid lookups get a short “Sorry, no results found…” Note

The output workbook uses bold frozen headers, filters, and styled hyperlinks.

## Adding more EPPO scripts

Shared pieces live under `src/`:

- `src/eppo/` — HTTP client and row-resolution helpers
- `src/cli/` — file prompts (input CSV/XLSX, output path, required columns)
- `src/excel/` — CSV/XLSX read and `writeWorkbook`

Keep keys in `.env` only. Prefer `scripts/EPPO/` for committed tools and `work/` for one-off experiments.
