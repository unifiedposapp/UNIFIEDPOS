// Complete ISO 4217 currency catalog — every ACTIVE code (SIX Interbank
// Clearing list): all national/legal-tender currencies plus supranational,
// funds, units-of-account and precious-metal codes. Mirrors
// packages/web/src/data/currencies.ts and is used for server-side validation.

export interface CurrencyDef {
  code: string;        // ISO 4217 alpha-3
  numeric: string;     // ISO 4217 numeric code
  decimals: number;    // minor unit; -1 = not applicable
  name: string;
  special?: boolean;   // funds code / unit of account / metal / reserved
}

export const CURRENCY_CATALOG: CurrencyDef[] = [
  { code: 'AED', numeric: '784', decimals: 2, name: 'UAE Dirham' },
  { code: 'AFN', numeric: '971', decimals: 2, name: 'Afghani' },
  { code: 'ALL', numeric: '008', decimals: 2, name: 'Lek' },
  { code: 'AMD', numeric: '051', decimals: 2, name: 'Armenian Dram' },
  { code: 'ANG', numeric: '532', decimals: 2, name: 'Netherlands Antillean Guilder' },
  { code: 'AOA', numeric: '973', decimals: 2, name: 'Kwanza' },
  { code: 'ARS', numeric: '032', decimals: 2, name: 'Argentine Peso' },
  { code: 'AUD', numeric: '036', decimals: 2, name: 'Australian Dollar' },
  { code: 'AWG', numeric: '533', decimals: 2, name: 'Aruban Florin' },
  { code: 'AZN', numeric: '944', decimals: 2, name: 'Azerbaijan Manat' },
  { code: 'BAM', numeric: '977', decimals: 2, name: 'Convertible Mark' },
  { code: 'BBD', numeric: '052', decimals: 2, name: 'Barbados Dollar' },
  { code: 'BDT', numeric: '050', decimals: 2, name: 'Taka' },
  { code: 'BGN', numeric: '975', decimals: 2, name: 'Bulgarian Lev' },
  { code: 'BHD', numeric: '048', decimals: 3, name: 'Bahraini Dinar' },
  { code: 'BIF', numeric: '108', decimals: 0, name: 'Burundi Franc' },
  { code: 'BMD', numeric: '060', decimals: 2, name: 'Bermudian Dollar' },
  { code: 'BND', numeric: '096', decimals: 2, name: 'Brunei Dollar' },
  { code: 'BOB', numeric: '068', decimals: 2, name: 'Boliviano' },
  { code: 'BOV', numeric: '984', decimals: 2, name: 'Mvdol (funds code)', special: true },
  { code: 'BRL', numeric: '986', decimals: 2, name: 'Brazilian Real' },
  { code: 'BSD', numeric: '044', decimals: 2, name: 'Bahamian Dollar' },
  { code: 'BTN', numeric: '064', decimals: 2, name: 'Ngultrum' },
  { code: 'BWP', numeric: '072', decimals: 2, name: 'Pula' },
  { code: 'BYN', numeric: '933', decimals: 2, name: 'Belarusian Ruble' },
  { code: 'BZD', numeric: '084', decimals: 2, name: 'Belize Dollar' },
  { code: 'CAD', numeric: '124', decimals: 2, name: 'Canadian Dollar' },
  { code: 'CDF', numeric: '976', decimals: 2, name: 'Congolese Franc' },
  { code: 'CHE', numeric: '947', decimals: 2, name: 'WIR Euro (funds code)', special: true },
  { code: 'CHF', numeric: '756', decimals: 2, name: 'Swiss Franc' },
  { code: 'CHW', numeric: '948', decimals: 2, name: 'WIR Franc (funds code)', special: true },
  { code: 'CLF', numeric: '990', decimals: 4, name: 'Unidad de Fomento (funds code)', special: true },
  { code: 'CLP', numeric: '152', decimals: 0, name: 'Chilean Peso' },
  { code: 'CNY', numeric: '156', decimals: 2, name: 'Yuan Renminbi' },
  { code: 'COP', numeric: '170', decimals: 2, name: 'Colombian Peso' },
  { code: 'COU', numeric: '970', decimals: 2, name: 'Unidad de Valor Real (funds code)', special: true },
  { code: 'CRC', numeric: '188', decimals: 2, name: 'Costa Rican Colon' },
  { code: 'CUC', numeric: '931', decimals: 2, name: 'Peso Convertible' },
  { code: 'CUP', numeric: '192', decimals: 2, name: 'Cuban Peso' },
  { code: 'CVE', numeric: '132', decimals: 2, name: 'Cabo Verde Escudo' },
  { code: 'CZK', numeric: '203', decimals: 2, name: 'Czech Koruna' },
  { code: 'DJF', numeric: '262', decimals: 0, name: 'Djibouti Franc' },
  { code: 'DKK', numeric: '208', decimals: 2, name: 'Danish Krone' },
  { code: 'DOP', numeric: '214', decimals: 2, name: 'Dominican Peso' },
  { code: 'DZD', numeric: '012', decimals: 2, name: 'Algerian Dinar' },
  { code: 'EGP', numeric: '818', decimals: 2, name: 'Egyptian Pound' },
  { code: 'ERN', numeric: '232', decimals: 2, name: 'Nakfa' },
  { code: 'ETB', numeric: '230', decimals: 2, name: 'Ethiopian Birr' },
  { code: 'EUR', numeric: '978', decimals: 2, name: 'Euro' },
  { code: 'FJD', numeric: '242', decimals: 2, name: 'Fiji Dollar' },
  { code: 'FKP', numeric: '238', decimals: 2, name: 'Falkland Islands Pound' },
  { code: 'GBP', numeric: '826', decimals: 2, name: 'Pound Sterling' },
  { code: 'GEL', numeric: '981', decimals: 2, name: 'Lari' },
  { code: 'GHS', numeric: '936', decimals: 2, name: 'Ghana Cedi' },
  { code: 'GIP', numeric: '292', decimals: 2, name: 'Gibraltar Pound' },
  { code: 'GMD', numeric: '270', decimals: 2, name: 'Dalasi' },
  { code: 'GNF', numeric: '324', decimals: 0, name: 'Guinean Franc' },
  { code: 'GTQ', numeric: '320', decimals: 2, name: 'Quetzal' },
  { code: 'GYD', numeric: '328', decimals: 2, name: 'Guyana Dollar' },
  { code: 'HKD', numeric: '344', decimals: 2, name: 'Hong Kong Dollar' },
  { code: 'HNL', numeric: '340', decimals: 2, name: 'Lempira' },
  { code: 'HTG', numeric: '332', decimals: 2, name: 'Gourde' },
  { code: 'HUF', numeric: '348', decimals: 2, name: 'Forint' },
  { code: 'IDR', numeric: '360', decimals: 2, name: 'Rupiah' },
  { code: 'ILS', numeric: '376', decimals: 2, name: 'New Israeli Sheqel' },
  { code: 'INR', numeric: '356', decimals: 2, name: 'Indian Rupee' },
  { code: 'IQD', numeric: '368', decimals: 3, name: 'Iraqi Dinar' },
  { code: 'IRR', numeric: '364', decimals: 2, name: 'Iranian Rial' },
  { code: 'ISK', numeric: '352', decimals: 0, name: 'Iceland Krona' },
  { code: 'JMD', numeric: '388', decimals: 2, name: 'Jamaican Dollar' },
  { code: 'JOD', numeric: '400', decimals: 3, name: 'Jordanian Dinar' },
  { code: 'JPY', numeric: '392', decimals: 0, name: 'Yen' },
  { code: 'KES', numeric: '404', decimals: 2, name: 'Kenyan Shilling' },
  { code: 'KGS', numeric: '417', decimals: 2, name: 'Som' },
  { code: 'KHR', numeric: '116', decimals: 2, name: 'Riel' },
  { code: 'KMF', numeric: '174', decimals: 0, name: 'Comorian Franc' },
  { code: 'KPW', numeric: '408', decimals: 2, name: 'North Korean Won' },
  { code: 'KRW', numeric: '410', decimals: 0, name: 'Won' },
  { code: 'KWD', numeric: '414', decimals: 3, name: 'Kuwaiti Dinar' },
  { code: 'KYD', numeric: '136', decimals: 2, name: 'Cayman Islands Dollar' },
  { code: 'KZT', numeric: '398', decimals: 2, name: 'Tenge' },
  { code: 'LAK', numeric: '418', decimals: 2, name: 'Lao Kip' },
  { code: 'LBP', numeric: '422', decimals: 2, name: 'Lebanese Pound' },
  { code: 'LKR', numeric: '144', decimals: 2, name: 'Sri Lanka Rupee' },
  { code: 'LRD', numeric: '430', decimals: 2, name: 'Liberian Dollar' },
  { code: 'LSL', numeric: '426', decimals: 2, name: 'Loti' },
  { code: 'LYD', numeric: '434', decimals: 3, name: 'Libyan Dinar' },
  { code: 'MAD', numeric: '504', decimals: 2, name: 'Moroccan Dirham' },
  { code: 'MDL', numeric: '498', decimals: 2, name: 'Moldovan Leu' },
  { code: 'MGA', numeric: '969', decimals: 2, name: 'Malagasy Ariary' },
  { code: 'MKD', numeric: '807', decimals: 2, name: 'Denar' },
  { code: 'MMK', numeric: '104', decimals: 2, name: 'Kyat' },
  { code: 'MNT', numeric: '496', decimals: 2, name: 'Tugrik' },
  { code: 'MOP', numeric: '446', decimals: 2, name: 'Pataca' },
  { code: 'MRU', numeric: '929', decimals: 2, name: 'Ouguiya' },
  { code: 'MUR', numeric: '480', decimals: 2, name: 'Mauritius Rupee' },
  { code: 'MVR', numeric: '462', decimals: 2, name: 'Rufiyaa' },
  { code: 'MWK', numeric: '454', decimals: 2, name: 'Malawi Kwacha' },
  { code: 'MXN', numeric: '484', decimals: 2, name: 'Mexican Peso' },
  { code: 'MXV', numeric: '979', decimals: 2, name: 'Mexican Unidad de Inversion (funds code)', special: true },
  { code: 'MYR', numeric: '458', decimals: 2, name: 'Malaysian Ringgit' },
  { code: 'MZN', numeric: '943', decimals: 2, name: 'Mozambique Metical' },
  { code: 'NAD', numeric: '516', decimals: 2, name: 'Namibia Dollar' },
  { code: 'NGN', numeric: '566', decimals: 2, name: 'Naira' },
  { code: 'NIO', numeric: '558', decimals: 2, name: 'Cordoba Oro' },
  { code: 'NOK', numeric: '578', decimals: 2, name: 'Norwegian Krone' },
  { code: 'NPR', numeric: '524', decimals: 2, name: 'Nepalese Rupee' },
  { code: 'NZD', numeric: '554', decimals: 2, name: 'New Zealand Dollar' },
  { code: 'OMR', numeric: '512', decimals: 3, name: 'Rial Omani' },
  { code: 'PAB', numeric: '590', decimals: 2, name: 'Balboa' },
  { code: 'PEN', numeric: '604', decimals: 2, name: 'Sol' },
  { code: 'PGK', numeric: '598', decimals: 2, name: 'Kina' },
  { code: 'PHP', numeric: '608', decimals: 2, name: 'Philippine Peso' },
  { code: 'PKR', numeric: '586', decimals: 2, name: 'Pakistan Rupee' },
  { code: 'PLN', numeric: '985', decimals: 2, name: 'Zloty' },
  { code: 'PYG', numeric: '600', decimals: 0, name: 'Guarani' },
  { code: 'QAR', numeric: '634', decimals: 2, name: 'Qatari Rial' },
  { code: 'RON', numeric: '946', decimals: 2, name: 'Romanian Leu' },
  { code: 'RSD', numeric: '941', decimals: 2, name: 'Serbian Dinar' },
  { code: 'RUB', numeric: '643', decimals: 2, name: 'Russian Ruble' },
  { code: 'RWF', numeric: '646', decimals: 0, name: 'Rwanda Franc' },
  { code: 'SAR', numeric: '682', decimals: 2, name: 'Saudi Riyal' },
  { code: 'SBD', numeric: '090', decimals: 2, name: 'Solomon Islands Dollar' },
  { code: 'SCR', numeric: '690', decimals: 2, name: 'Seychelles Rupee' },
  { code: 'SDG', numeric: '938', decimals: 2, name: 'Sudanese Pound' },
  { code: 'SEK', numeric: '752', decimals: 2, name: 'Swedish Krona' },
  { code: 'SGD', numeric: '702', decimals: 2, name: 'Singapore Dollar' },
  { code: 'SHP', numeric: '654', decimals: 2, name: 'Saint Helena Pound' },
  { code: 'SLE', numeric: '925', decimals: 2, name: 'Leone' },
  { code: 'SOS', numeric: '706', decimals: 2, name: 'Somali Shilling' },
  { code: 'SRD', numeric: '968', decimals: 2, name: 'Surinam Dollar' },
  { code: 'SSP', numeric: '728', decimals: 2, name: 'South Sudanese Pound' },
  { code: 'STN', numeric: '930', decimals: 2, name: 'Dobra' },
  { code: 'SVC', numeric: '222', decimals: 2, name: 'El Salvador Colon' },
  { code: 'SYP', numeric: '760', decimals: 2, name: 'Syrian Pound' },
  { code: 'SZL', numeric: '748', decimals: 2, name: 'Lilangeni' },
  { code: 'THB', numeric: '764', decimals: 2, name: 'Baht' },
  { code: 'TJS', numeric: '972', decimals: 2, name: 'Somoni' },
  { code: 'TMT', numeric: '934', decimals: 2, name: 'Turkmenistan New Manat' },
  { code: 'TND', numeric: '788', decimals: 3, name: 'Tunisian Dinar' },
  { code: 'TOP', numeric: '776', decimals: 2, name: 'Pa’anga' },
  { code: 'TRY', numeric: '949', decimals: 2, name: 'Turkish Lira' },
  { code: 'TTD', numeric: '780', decimals: 2, name: 'Trinidad and Tobago Dollar' },
  { code: 'TWD', numeric: '901', decimals: 2, name: 'New Taiwan Dollar' },
  { code: 'TZS', numeric: '834', decimals: 2, name: 'Tanzanian Shilling' },
  { code: 'UAH', numeric: '980', decimals: 2, name: 'Hryvnia' },
  { code: 'UGX', numeric: '800', decimals: 0, name: 'Uganda Shilling' },
  { code: 'USD', numeric: '840', decimals: 2, name: 'US Dollar' },
  { code: 'USN', numeric: '997', decimals: 2, name: 'US Dollar (next day, funds code)', special: true },
  { code: 'UYI', numeric: '940', decimals: 0, name: 'Uruguay Unidad Previsional (funds code)', special: true },
  { code: 'UYU', numeric: '858', decimals: 2, name: 'Peso Uruguayo' },
  { code: 'UYW', numeric: '927', decimals: 4, name: 'Uruguay Unidad Previsional (funds code)', special: true },
  { code: 'UZS', numeric: '860', decimals: 2, name: 'Uzbekistan Sum' },
  { code: 'VED', numeric: '926', decimals: 2, name: 'Bolivar Soberano (digital)' },
  { code: 'VES', numeric: '928', decimals: 2, name: 'Bolivar Soberano' },
  { code: 'VND', numeric: '704', decimals: 0, name: 'Dong' },
  { code: 'VUV', numeric: '548', decimals: 0, name: 'Vatu' },
  { code: 'WST', numeric: '882', decimals: 2, name: 'Tala' },
  { code: 'XAF', numeric: '950', decimals: 0, name: 'CFA Franc BEAC' },
  { code: 'XAG', numeric: '961', decimals: -1, name: 'Silver (one troy ounce)', special: true },
  { code: 'XAU', numeric: '959', decimals: -1, name: 'Gold (one troy ounce)', special: true },
  { code: 'XBA', numeric: '955', decimals: -1, name: 'Bond Markets Unit EURCO', special: true },
  { code: 'XBB', numeric: '956', decimals: -1, name: 'Bond Markets Unit E.M.U.-6', special: true },
  { code: 'XBC', numeric: '957', decimals: -1, name: 'Bond Markets Unit E.U.A.-9', special: true },
  { code: 'XBD', numeric: '958', decimals: -1, name: 'Bond Markets Unit E.U.A.-17', special: true },
  { code: 'XCD', numeric: '951', decimals: 2, name: 'East Caribbean Dollar' },
  { code: 'XDR', numeric: '960', decimals: -1, name: 'SDR (Special Drawing Right)', special: true },
  { code: 'XOF', numeric: '952', decimals: 0, name: 'CFA Franc BCEAO' },
  { code: 'XPD', numeric: '964', decimals: -1, name: 'Palladium (one troy ounce)', special: true },
  { code: 'XPF', numeric: '953', decimals: 0, name: 'CFP Franc' },
  { code: 'XPT', numeric: '962', decimals: -1, name: 'Platinum (one troy ounce)', special: true },
  { code: 'XSU', numeric: '994', decimals: -1, name: 'Sucre (ALBA-TCP unit of account)', special: true },
  { code: 'XTS', numeric: '963', decimals: -1, name: 'Code reserved for testing', special: true },
  { code: 'XUA', numeric: '965', decimals: -1, name: 'ADB Unit of Account', special: true },
  { code: 'XXX', numeric: '999', decimals: -1, name: 'No currency', special: true },
  { code: 'YER', numeric: '886', decimals: 2, name: 'Yemeni Rial' },
  { code: 'ZAR', numeric: '710', decimals: 2, name: 'Rand' },
  { code: 'ZMW', numeric: '967', decimals: 2, name: 'Zambian Kwacha' },
  { code: 'ZWG', numeric: '924', decimals: 2, name: 'Zimbabwe Gold' },
];

export const CURRENCY_CODES = new Set(CURRENCY_CATALOG.map((c) => c.code));

export const CURRENCY_BY_CODE: Record<string, CurrencyDef> = Object.fromEntries(
  CURRENCY_CATALOG.map((c) => [c.code, c])
);

export function isValidCurrency(code: unknown): boolean {
  return typeof code === 'string' && CURRENCY_CODES.has(code.toUpperCase());
}

// Normalises user input ("usd " -> "USD"); returns null when not ISO 4217.
export function normalizeCurrency(code: unknown): string | null {
  if (typeof code !== 'string') return null;
  const up = code.trim().toUpperCase();
  return CURRENCY_CODES.has(up) ? up : null;
}

// ─── Minor-unit helpers ─────────────────────────────────────────────────
// Payment processors (Stripe, Adyen...) work in the currency's minor unit
// (cents). These convert to/from major units using the ISO 4217 exponent so
// JPY (0 decimals), BHD (3) and USD (2) are all handled correctly.
export function currencyDecimals(code: string): number {
  const d = CURRENCY_BY_CODE[(code || '').toUpperCase()]?.decimals;
  return d == null || d < 0 ? 2 : d;
}

export function toMinorUnits(amount: number, code: string): number {
  return Math.round(amount * Math.pow(10, currencyDecimals(code)));
}

export function fromMinorUnits(minor: number, code: string): number {
  return minor / Math.pow(10, currencyDecimals(code));
}
