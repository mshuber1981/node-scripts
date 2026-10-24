import { createHttpClient } from '../http/client.js';

const EPPO_BASE_URL = 'https://api.eppo.int/gd/v2';

/**
 * @typedef {object} EppoTaxonOverview
 * @property {string} [eppocode]
 * @property {string} [prefname]
 * @property {boolean} [is_active]
 * @property {string | null} [replacedby]
 * @property {string} [datatype]
 * @property {string} [datecreate]
 * @property {string} [lastupdate]
 */

/**
 * @typedef {object} EppoNameToCode
 * @property {string} eppocode
 * @property {boolean} preferred
 */

/**
 * @param {object} [options]
 * @param {string} [options.apiKey]
 * @param {string} [options.prefixUrl]
 * @param {number} [options.timeoutMs]
 * @returns {{ getTaxonOverview: (code: string) => Promise<EppoTaxonOverview | null>, nameToCodes: (name: string) => Promise<EppoNameToCode[]> }}
 */
export function createEppoClient(options = {}) {
  const apiKey = options.apiKey ?? process.env.EPPO_KEY;
  if (!apiKey) {
    throw new Error('EPPO_KEY is not set. Add it to your .env file.');
  }

  const http = createHttpClient({
    prefixUrl: options.prefixUrl ?? EPPO_BASE_URL,
    timeoutMs: options.timeoutMs,
    gotOptions: {
      headers: {
        Accept: 'application/json',
        'X-Api-Key': apiKey,
      },
    },
  });

  /**
   * @param {string} code
   * @returns {Promise<EppoTaxonOverview | null>}
   */
  async function getTaxonOverview(code) {
    try {
      return await http.get(`taxons/taxon/${encodeURIComponent(code)}/overview`).json();
    } catch (error) {
      if (error && typeof error === 'object' && 'response' in error) {
        const response = /** @type {{ statusCode?: number }} */ (error).response;
        if (response?.statusCode === 404) {
          return null;
        }
      }
      throw error;
    }
  }

  /**
   * @param {string} name
   * @returns {Promise<EppoNameToCode[]>}
   */
  async function nameToCodes(name) {
    const results = await http
      .get('tools/name2codes', {
        searchParams: {
          name,
          onlyPreferred: 'false',
        },
      })
      .json();
    return Array.isArray(results) ? results : [];
  }

  return { getTaxonOverview, nameToCodes };
}
