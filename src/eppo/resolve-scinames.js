/**
 * @typedef {import('./client.js').EppoTaxonOverview} EppoTaxonOverview
 * @typedef {import('./client.js').EppoNameToCode} EppoNameToCode
 */

/**
 * @typedef {object} ScinameInputRow
 * @property {string} [providedCode]
 * @property {string} [providedSciname]
 */

/**
 * @typedef {object} ScinameOutputRow
 * @property {string | null} providedCode
 * @property {string | null} providedSciname
 * @property {string | null} preferredSciname
 * @property {string | { text: string, hyperlink: string } | null} note
 */

/**
 * @param {unknown} value
 * @returns {string | null}
 */
export function normalizeCell(value) {
  if (value == null) {
    return null;
  }
  const text = String(value).trim();
  return text === '' ? null : text;
}

/**
 * @param {string} code
 * @returns {string}
 */
function taxonUrl(code) {
  return `https://gd.eppo.int/taxon/${encodeURIComponent(code)}`;
}

/**
 * @param {EppoTaxonOverview} overview
 * @returns {string | { text: string, hyperlink: string } | null}
 */
export function deactivatedNote(overview) {
  const code = overview.eppocode;
  if (!code) {
    return null;
  }

  const inactive = overview.is_active === false;
  const replacedBy =
    overview.replacedby == null || overview.replacedby === '' ? null : String(overview.replacedby);

  if (!inactive && !replacedBy) {
    return null;
  }

  if (replacedBy) {
    return {
      text: `This code has been deactivated and replaced by ${replacedBy}`,
      hyperlink: taxonUrl(code),
    };
  }

  return {
    text: 'This code has been deactivated',
    hyperlink: taxonUrl(code),
  };
}

/**
 * @param {string | null} note
 * @param {string | { text: string, hyperlink: string } | null} deactivation
 * @returns {string | { text: string, hyperlink: string } | null}
 */
function combineNotes(note, deactivation) {
  if (!note) {
    return deactivation;
  }
  if (!deactivation) {
    return note;
  }
  const deactivationText = typeof deactivation === 'string' ? deactivation : deactivation.text;
  if (typeof deactivation === 'object' && deactivation !== null) {
    return {
      text: `${note}; ${deactivationText}`,
      hyperlink: deactivation.hyperlink,
    };
  }
  return `${note}; ${deactivationText}`;
}

/**
 * Build output row(s) from one input row and EPPO lookup results.
 *
 * @param {ScinameInputRow} input
 * @param {object} lookups
 * @param {EppoTaxonOverview | null | undefined} lookups.codeOverview
 *   Overview for the provided code. `undefined` means code was not looked up;
 *   `null` means not found.
 * @param {EppoNameToCode[]} [lookups.nameMatches]
 * @param {Map<string, EppoTaxonOverview | null>} [lookups.overviewsByCode]
 *   Overviews for codes discovered via name (and for expansion rows).
 * @returns {ScinameOutputRow[]}
 */
export function resolveScinameRow(input, lookups) {
  const providedCode = normalizeCell(input.providedCode);
  const providedSciname = normalizeCell(input.providedSciname);
  const nameMatches = lookups.nameMatches ?? [];
  const overviewsByCode = lookups.overviewsByCode ?? new Map();
  const codeOverview = lookups.codeOverview;

  const nameCodes = [...new Set(nameMatches.map((match) => match.eppocode).filter(Boolean))];
  const nameFound = nameCodes.length > 0;
  const codeFound = codeOverview != null;

  if (!providedCode && !providedSciname) {
    return [];
  }

  if (!providedCode && providedSciname) {
    if (!nameFound) {
      return [
        {
          providedCode: null,
          providedSciname,
          preferredSciname: null,
          note: 'Sorry, no results found for provided Sciname',
        },
      ];
    }

    return nameCodes.map((code) => {
      const overview = overviewsByCode.get(code) ?? null;
      return {
        providedCode: code,
        providedSciname,
        preferredSciname: overview?.prefname ?? null,
        note: overview ? deactivatedNote(overview) : null,
      };
    });
  }

  if (providedCode && !providedSciname) {
    if (!codeFound) {
      return [
        {
          providedCode,
          providedSciname: null,
          preferredSciname: null,
          note: 'Sorry, no results found for EPPO code',
        },
      ];
    }

    return [
      {
        providedCode: codeOverview.eppocode ?? providedCode,
        providedSciname: null,
        preferredSciname: codeOverview.prefname ?? null,
        note: deactivatedNote(codeOverview),
      },
    ];
  }

  if (!codeFound && !nameFound) {
    return [
      {
        providedCode,
        providedSciname,
        preferredSciname: null,
        note: 'Sorry, no results found',
      },
    ];
  }

  if (!codeFound && nameFound) {
    return nameCodes.map((code) => {
      const overview = overviewsByCode.get(code) ?? null;
      return {
        providedCode: code,
        providedSciname,
        preferredSciname: overview?.prefname ?? null,
        note: overview ? deactivatedNote(overview) : 'Sorry, no results found for EPPO code',
      };
    });
  }

  const preferred = codeOverview.prefname ?? null;
  const preferredMatchesName =
    preferred != null &&
    providedSciname != null &&
    preferred.localeCompare(providedSciname, undefined, { sensitivity: 'accent' }) === 0;
  const sameCodeMatch = preferredMatchesName || nameCodes.includes(providedCode);
  const otherCodes = nameCodes.filter((code) => code !== providedCode);
  const deactivation = deactivatedNote(codeOverview);

  if (!nameFound && !preferredMatchesName) {
    return [
      {
        providedCode: codeOverview.eppocode ?? providedCode,
        providedSciname,
        preferredSciname: preferred,
        note: combineNotes('Provided Sciname not found', deactivation),
      },
    ];
  }

  if (sameCodeMatch && otherCodes.length === 0) {
    return [
      {
        providedCode: codeOverview.eppocode ?? providedCode,
        providedSciname,
        preferredSciname: preferred,
        note: deactivation,
      },
    ];
  }

  if (otherCodes.length > 0) {
    /** @type {ScinameOutputRow[]} */
    const rows = [
      {
        providedCode: codeOverview.eppocode ?? providedCode,
        providedSciname,
        preferredSciname: preferred,
        note: combineNotes(
          'Provided Sciname referred to a different EPPO code resulting in one or more new rows',
          deactivation,
        ),
      },
    ];

    for (const code of otherCodes) {
      const overview = overviewsByCode.get(code) ?? null;
      rows.push({
        providedCode: code,
        providedSciname,
        preferredSciname: overview?.prefname ?? null,
        note: 'New row',
      });
    }

    return rows;
  }

  return [
    {
      providedCode: codeOverview.eppocode ?? providedCode,
      providedSciname,
      preferredSciname: preferred,
      note: deactivation,
    },
  ];
}
