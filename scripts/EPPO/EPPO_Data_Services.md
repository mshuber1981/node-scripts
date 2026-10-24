# EPPO Global Database API (GDAPI)

API reference for scripts in this folder. For how to run them and set `EPPO_KEY`, see [README.md](./README.md).

**Last checked:** 2026-10-24  
**API version:** 2.0.4 (OpenAPI dated 2026.07.04)

## Links

| What                           | URL                                           |
| ------------------------------ | --------------------------------------------- |
| Docs UI (Stoplight Elements)   | https://data.eppo.int/apis/GDAPI              |
| OpenAPI YAML (source of truth) | https://api.eppo.int/gd/v2/eppo_api_gd_v2.yml |
| Dashboard / API key            | https://data.eppo.int                         |
| Production base URL            | `https://api.eppo.int/gd/v2`                  |
| Dev server (in OpenAPI)        | `https://api2025.eppo.dev:6443/gd/v2`         |

Portal page is public OpenAPI docs; interactive Try-It is hidden (`hideTryIt`). Spec is ~2400 lines — prefer this summary + re-fetch YAML when endpoints change.

## Auth

- Scheme: API key header `X-Api-Key`
- Generate key from https://data.eppo.int dashboard
- This repo uses repo-root `.env`:

```bash
EPPO_KEY=...
```

(Bayer `spirit-scripts` uses the same variable name.)

Example:

```http
GET https://api.eppo.int/gd/v2/tools/search?keyword=Bemisia
Accept: application/json
X-Api-Key: <key>
```

## Rate limiting

Effective **2026-05-22** (per OpenAPI description):

- Max **2000 requests per IP** in a **10-second sliding window**
- Parallel requests allowed if under the limit
- Over limit → **HTTP 429** with body fields like `rate_limit.limit`, `remaining`, `reset_time`, `retry_after`

Older notes/scripts sometimes assumed ~60 req / 10s — treat OpenAPI as current. For batch jobs, still pace requests and honor `retry_after` on 429.

## Identifiers

| Type        | Pattern           | Example  |
| ----------- | ----------------- | -------- |
| EPPO code   | `^[0-9A-Z]{5,6}$` | `BEMITA` |
| ISO country | `^[0-9A-Z]{2}$`   | `FR`     |
| RPPO code   | `^9[A-Z]$`        | `9A`     |

Taxon overview example fields: `eppocode`, `prefname`, `is_active`, `replacedby`, `datatype`, dates.

## Endpoint map (all GET unless noted)

### General

| Path      | Notes                                            |
| --------- | ------------------------------------------------ |
| `/status` | Health; returns `status`, `timestamp`, `version` |

### Tools (best first-script targets)

| Path                | Query                                                                                                     | Notes                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `/tools/search`     | `keyword` (required, min 3), `onlyPreferred`, `searchMode` (1 exact / 2 starts-with default / 3 contains) | Max **10** results; preferred names first; matches name or EPPO-like code |
| `/tools/name2codes` | `name` (required), `onlyPreferred` (default true)                                                         | Name → EPPO codes                                                         |

`ToolsSearchResponse`: `eppocode`, `full_name`, `is_preferred`, `isolang`, `language`, `statuscode`, `preferred_name`  
`NameToCodeResponse`: `eppocode`, `preferred`

### Taxons

| Path                                          | Notes                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/taxons/list`                                | Paginated catalog. Query: `createdFromDate`, `updatedFromDate`, `orderBy` (`creation` \| `datecreate` \| `eppocode` \| `dateupdate`), `orderAsc`, `limit` (1–1000, default 100), `offset` (0-based). Response: `{ pagination, meta, data[] }` with `eppocode`, `is_active`, dates, `replacedby`, `datatype` |
| `/taxons/taxon/{EPPOCODE}/overview`           | Preferred name + basic taxon fields (good lookup by code)                                                                                                                                                                                                                                                   |
| `/taxons/taxon/{EPPOCODE}/infos`              | Counts of available related record types                                                                                                                                                                                                                                                                    |
| `/taxons/taxon/{EPPOCODE}/names`              | Names / synonyms                                                                                                                                                                                                                                                                                            |
| `/taxons/taxon/{EPPOCODE}/taxonomy`           | Classification hierarchy                                                                                                                                                                                                                                                                                    |
| `/taxons/taxon/{EPPOCODE}/categorization`     | Regulatory categorization by country                                                                                                                                                                                                                                                                        |
| `/taxons/taxon/{EPPOCODE}/kingdom`            | Kingdom                                                                                                                                                                                                                                                                                                     |
| `/taxons/taxon/{EPPOCODE}/hosts`              | Hosts                                                                                                                                                                                                                                                                                                       |
| `/taxons/taxon/{EPPOCODE}/pests`              | Pests                                                                                                                                                                                                                                                                                                       |
| `/taxons/taxon/{EPPOCODE}/vectors`            | Vectors                                                                                                                                                                                                                                                                                                     |
| `/taxons/taxon/{EPPOCODE}/vectorof`           | Vector-of                                                                                                                                                                                                                                                                                                   |
| `/taxons/taxon/{EPPOCODE}/bca`                | Biological control agents                                                                                                                                                                                                                                                                                   |
| `/taxons/taxon/{EPPOCODE}/bcaof`              | BCA-of                                                                                                                                                                                                                                                                                                      |
| `/taxons/taxon/{EPPOCODE}/photos`             | Photos                                                                                                                                                                                                                                                                                                      |
| `/taxons/taxon/{EPPOCODE}/reporting_articles` | Reporting Service articles                                                                                                                                                                                                                                                                                  |
| `/taxons/taxon/{EPPOCODE}/documents`          | Documents                                                                                                                                                                                                                                                                                                   |
| `/taxons/taxon/{EPPOCODE}/standards`          | Standards                                                                                                                                                                                                                                                                                                   |
| `/taxons/taxon/{EPPOCODE}/distribution`       | Geographical distribution                                                                                                                                                                                                                                                                                   |

### Country / RPPO

| Path                                | Notes               |
| ----------------------------------- | ------------------- |
| `/country/{ISOCODE}/overview`       | Country overview    |
| `/country/{ISOCODE}/categorization` | Categorization      |
| `/country/{ISOCODE}/presence`       | Presence            |
| `/rppo/{RPPOCODE}/overview`         | RPPO overview       |
| `/rppo/{RPPOCODE}/categorization`   | RPPO categorization |

### Reporting Service

| Path                                   | Notes        |
| -------------------------------------- | ------------ |
| `/reportings/list`                     | List reports |
| `/reportings/reporting/{reporting_id}` | One report   |
| `/reportings/article/{article_id}`     | One article  |

### References (lookup tables)

| Path                                 | Notes                     |
| ------------------------------------ | ------------------------- |
| `/references/rppos`                  | RPPO list                 |
| `/references/qList`                  | Q list                    |
| `/references/distributionStatus`     | Distribution status codes |
| `/references/pestHostClassification` | Pest–host classification  |
| `/references/vectorClassification`   | Vector classification     |
| `/references/countries`              | Countries                 |
| `/references/countriesStates`        | Countries + states        |

## Error shapes (common)

Expect JSON errors for:

- **401** — missing/invalid API key (`API key is invalid or inactive`)
- **403** — insufficient permissions
- **404** — route/resource not found
- **400** — bad params (`status: -1`, field `errors`)
- **429** — rate limit (see above)
- **500** — server error

## Script ideas (beyond current tools)

1. **Smoke / health** — `GET /status` + one authenticated `/tools/search`
2. **Incremental sync** — `/taxons/list?updatedFromDate=…` with `limit`/`offset`
3. Hosts / pests / distribution reports from `/taxons/taxon/{EPPOCODE}/…`

`get-eppo-scinames.js` already covers name↔code / preferred-name lookup. Reuse `src/eppo/` and `got`. Keep keys in `.env` only.

Refresh this file from the OpenAPI YAML when auth, rate limits, or paths drift.
