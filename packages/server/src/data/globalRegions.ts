// ─── Global Region Taxonomy (UN M49 geoscheme) ─────────────────────────────
// Authoritative, server-side mapping of EVERY ISO 3166-1 alpha-2 country/territory
// code into the United Nations geoscheme: continent → sub-region.
//
// This is the single source of truth used by the Enterprise module (§23
// Multi-Location Enterprise, §46 Scalability) so that global regions can be
// provisioned with a hard guarantee that no nation or country is left out.
//
// The 18 sub-regions below partition all 249 codes exactly once:
//   Africa       60  (Northern 7 · Sub-Saharan 53)
//   Americas     55  (Northern America 5 · Latin America & Caribbean 50)
//   Asia         51  (Central 5 · Eastern 8 · South-eastern 11 · Southern 9 · Western 18)
//   Europe       51  (Eastern 10 · Northern 16 · Southern 16 · Western 9)
//   Oceania      29  (Australia & NZ 6 · Melanesia 5 · Micronesia 8 · Polynesia 10)
//   Antarctica    3  (AQ + sub-Antarctic territories BV, GS)
//   TOTAL       249
//
// Sub-Antarctic territories with no UN geoscheme sub-region (Bouvet Island BV,
// South Georgia & the South Sandwich Islands GS) are grouped under Antarctica so
// coverage stays complete; French Southern Territories (TF) follow the UN and sit
// in Sub-Saharan Africa, Heard Island & McDonald Islands (HM) in Australia & NZ.

export interface GlobalSubregion {
  continent: string;
  subregion: string;
  /** ISO 3166-1 alpha-2 codes covered by this sub-region. */
  countries: string[];
}

export const GLOBAL_SUBREGIONS: GlobalSubregion[] = [
  {
    continent: 'Africa',
    subregion: 'Northern Africa',
    countries: ['DZ', 'EG', 'EH', 'LY', 'MA', 'SD', 'TN'],
  },
  {
    continent: 'Africa',
    subregion: 'Sub-Saharan Africa',
    countries: [
      'AO', 'BF', 'BI', 'BJ', 'BW', 'CD', 'CF', 'CG', 'CI', 'CM', 'CV', 'DJ',
      'ER', 'ET', 'GA', 'GH', 'GM', 'GN', 'GQ', 'GW', 'IO', 'KE', 'KM', 'LR',
      'LS', 'MG', 'ML', 'MR', 'MU', 'MW', 'MZ', 'NA', 'NE', 'NG', 'RE', 'RW',
      'SC', 'SH', 'SL', 'SN', 'SO', 'SS', 'ST', 'SZ', 'TD', 'TF', 'TG', 'TZ',
      'UG', 'YT', 'ZA', 'ZM', 'ZW',
    ],
  },
  {
    continent: 'Americas',
    subregion: 'Northern America',
    countries: ['BM', 'CA', 'GL', 'PM', 'US'],
  },
  {
    continent: 'Americas',
    subregion: 'Latin America and the Caribbean',
    countries: [
      'AG', 'AI', 'AR', 'AW', 'BB', 'BL', 'BO', 'BQ', 'BR', 'BS', 'BZ', 'CL',
      'CO', 'CR', 'CU', 'CW', 'DM', 'DO', 'EC', 'FK', 'GD', 'GF', 'GP', 'GT',
      'GY', 'HN', 'HT', 'JM', 'KN', 'KY', 'LC', 'MF', 'MQ', 'MS', 'MX', 'NI',
      'PA', 'PE', 'PR', 'PY', 'SR', 'SV', 'SX', 'TC', 'TT', 'UY', 'VC', 'VE',
      'VG', 'VI',
    ],
  },
  {
    continent: 'Asia',
    subregion: 'Central Asia',
    countries: ['KG', 'KZ', 'TJ', 'TM', 'UZ'],
  },
  {
    continent: 'Asia',
    subregion: 'Eastern Asia',
    countries: ['CN', 'HK', 'JP', 'KP', 'KR', 'MN', 'MO', 'TW'],
  },
  {
    continent: 'Asia',
    subregion: 'South-eastern Asia',
    countries: ['BN', 'ID', 'KH', 'LA', 'MM', 'MY', 'PH', 'SG', 'TH', 'TL', 'VN'],
  },
  {
    continent: 'Asia',
    subregion: 'Southern Asia',
    countries: ['AF', 'BD', 'BT', 'IN', 'IR', 'LK', 'MV', 'NP', 'PK'],
  },
  {
    continent: 'Asia',
    subregion: 'Western Asia',
    countries: [
      'AE', 'AM', 'AZ', 'BH', 'CY', 'GE', 'IL', 'IQ', 'JO', 'KW', 'LB', 'OM',
      'PS', 'QA', 'SA', 'SY', 'TR', 'YE',
    ],
  },
  {
    continent: 'Europe',
    subregion: 'Eastern Europe',
    countries: ['BG', 'BY', 'CZ', 'HU', 'MD', 'PL', 'RO', 'RU', 'SK', 'UA'],
  },
  {
    continent: 'Europe',
    subregion: 'Northern Europe',
    countries: [
      'AX', 'DK', 'EE', 'FI', 'FO', 'GB', 'GG', 'IE', 'IM', 'IS', 'JE', 'LT',
      'LV', 'NO', 'SE', 'SJ',
    ],
  },
  {
    continent: 'Europe',
    subregion: 'Southern Europe',
    countries: [
      'AD', 'AL', 'BA', 'ES', 'GI', 'GR', 'HR', 'IT', 'ME', 'MK', 'MT', 'PT',
      'RS', 'SI', 'SM', 'VA',
    ],
  },
  {
    continent: 'Europe',
    subregion: 'Western Europe',
    countries: ['AT', 'BE', 'CH', 'DE', 'FR', 'LI', 'LU', 'MC', 'NL'],
  },
  {
    continent: 'Oceania',
    subregion: 'Australia and New Zealand',
    countries: ['AU', 'CC', 'CX', 'HM', 'NF', 'NZ'],
  },
  {
    continent: 'Oceania',
    subregion: 'Melanesia',
    countries: ['FJ', 'NC', 'PG', 'SB', 'VU'],
  },
  {
    continent: 'Oceania',
    subregion: 'Micronesia',
    countries: ['FM', 'GU', 'KI', 'MH', 'MP', 'NR', 'PW', 'UM'],
  },
  {
    continent: 'Oceania',
    subregion: 'Polynesia',
    countries: ['AS', 'CK', 'NU', 'PF', 'PN', 'TK', 'TO', 'TV', 'WF', 'WS'],
  },
  {
    continent: 'Antarctica',
    subregion: 'Antarctica',
    countries: ['AQ', 'BV', 'GS'],
  },
];

/** Fixed display order for continents. */
export const CONTINENT_ORDER: string[] = [
  'Africa',
  'Americas',
  'Asia',
  'Europe',
  'Oceania',
  'Antarctica',
];

/** Every covered ISO code, derived from the taxonomy itself (249). */
export const ALL_COUNTRY_CODES: string[] = GLOBAL_SUBREGIONS.flatMap((s) => s.countries);

/** Authoritative total number of nations/countries/territories (249). */
export const GLOBAL_COUNTRY_COUNT: number = ALL_COUNTRY_CODES.length;

/** code → { continent, subregion } lookup, derived from the taxonomy. */
export const COUNTRY_TO_SUBREGION: Record<string, { continent: string; subregion: string }> =
  GLOBAL_SUBREGIONS.reduce((acc, s) => {
    for (const code of s.countries) acc[code] = { continent: s.continent, subregion: s.subregion };
    return acc;
  }, {} as Record<string, { continent: string; subregion: string }>);

/** continent → codes, derived from the taxonomy. */
export const CODES_BY_CONTINENT: Record<string, string[]> = GLOBAL_SUBREGIONS.reduce(
  (acc, s) => {
    (acc[s.continent] ||= []).push(...s.countries);
    return acc;
  },
  {} as Record<string, string[]>,
);

/** Stable, unique key for a sub-region (used for idempotent provisioning). */
export const subregionKey = (continent: string, subregion: string): string =>
  `${continent}__${subregion}`;

/** Human-readable region name, e.g. "Africa · Northern Africa". */
export const subregionName = (continent: string, subregion: string): string =>
  continent === subregion ? continent : `${continent} · ${subregion}`;

export interface CoverageBucket {
  continent: string;
  subregion: string;
  total: number;
  covered: number;
  complete: boolean;
}

export interface CoverageReport {
  /** Total nations/countries expected globally (249). */
  total: number;
  /** How many are covered by the organization's regions. */
  covered: number;
  /** ISO codes not covered by any region. Empty when coverage is complete. */
  uncovered: string[];
  /** True when every nation is covered (no country left out). */
  complete: boolean;
  /** Per-continent totals vs covered. */
  byContinent: CoverageBucket[];
  /** Per-sub-region totals vs covered. */
  bySubregion: CoverageBucket[];
}

/**
 * Compute global coverage for a set of already-covered ISO codes.
 * Any code not in ALL_COUNTRY_CODES is ignored (defensive against stale data).
 */
export function computeCoverage(coveredCodes: Iterable<string>): CoverageReport {
  const known = new Set(ALL_COUNTRY_CODES);
  const covered = new Set<string>();
  for (const code of coveredCodes) if (known.has(code)) covered.add(code);

  const uncovered = ALL_COUNTRY_CODES.filter((c) => !covered.has(c));

  const bySubregion: CoverageBucket[] = GLOBAL_SUBREGIONS.map((s) => ({
    continent: s.continent,
    subregion: s.subregion,
    total: s.countries.length,
    covered: s.countries.filter((c) => covered.has(c)).length,
    complete: s.countries.every((c) => covered.has(c)),
  }));

  const byContinent: CoverageBucket[] = CONTINENT_ORDER.map((continent) => {
    const codes = CODES_BY_CONTINENT[continent] || [];
    return {
      continent,
      subregion: '',
      total: codes.length,
      covered: codes.filter((c) => covered.has(c)).length,
      complete: codes.every((c) => covered.has(c)),
    };
  });

  return {
    total: GLOBAL_COUNTRY_COUNT,
    covered: GLOBAL_COUNTRY_COUNT - uncovered.length,
    uncovered,
    complete: uncovered.length === 0,
    byContinent,
    bySubregion,
  };
}
