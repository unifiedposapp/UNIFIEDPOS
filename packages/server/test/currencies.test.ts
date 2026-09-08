import { describe, it, expect } from 'vitest';
import {
  isValidCurrency,
  normalizeCurrency,
  currencyDecimals,
  toMinorUnits,
  fromMinorUnits,
  CURRENCY_CATALOG,
} from '../src/data/currencies';

describe('ISO 4217 catalog integrity', () => {
  it('has no duplicate codes', () => {
    const codes = CURRENCY_CATALOG.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('uses only 3-letter upper-case alpha codes', () => {
    for (const c of CURRENCY_CATALOG) {
      expect(c.code).toMatch(/^[A-Z]{3}$/);
    }
  });

  it('includes the special / metal / funds codes apps usually omit', () => {
    for (const code of ['XDR', 'XSU', 'XUA', 'XAU', 'XAG', 'XPT', 'XPD', 'XXX', 'XTS', 'ZWG', 'MRU', 'STN', 'SLE', 'CLF', 'COU', 'UYI', 'BOV', 'CHE', 'CHW', 'MXV']) {
      expect(isValidCurrency(code), `${code} should be present`).toBe(true);
    }
  });
});

describe('currency validation & normalisation', () => {
  it('validates known codes case-insensitively', () => {
    expect(isValidCurrency('usd')).toBe(true);
    expect(isValidCurrency('NGN')).toBe(true);
    expect(isValidCurrency('ZZZ')).toBe(false);
    expect(isValidCurrency(123 as unknown)).toBe(false);
  });

  it('normalises input and rejects invalid codes', () => {
    expect(normalizeCurrency(' eur ')).toBe('EUR');
    expect(normalizeCurrency('jpy')).toBe('JPY');
    expect(normalizeCurrency('nope')).toBeNull();
    expect(normalizeCurrency(undefined)).toBeNull();
  });
});

describe('minor-unit conversion (processor cents)', () => {
  it('uses the correct ISO 4217 exponent per currency', () => {
    expect(currencyDecimals('JPY')).toBe(0);
    expect(currencyDecimals('BHD')).toBe(3);
    expect(currencyDecimals('USD')).toBe(2);
  });

  it('converts to and from minor units without drift', () => {
    expect(toMinorUnits(12.5, 'USD')).toBe(1250);
    expect(toMinorUnits(1250, 'JPY')).toBe(1250);
    expect(toMinorUnits(1.234, 'BHD')).toBe(1234);
    expect(fromMinorUnits(1250, 'USD')).toBe(12.5);
    expect(fromMinorUnits(1234, 'BHD')).toBe(1.234);
  });
});
