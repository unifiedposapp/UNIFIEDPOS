import { describe, it, expect } from 'vitest';
import {
  TAX_PROFILES,
  TAX_REGION_ORDER,
  taxProfileFor,
  suggestedTaxRateFor,
  isKnownTaxCountry,
  taxProfilesByRegion,
  taxCoverage,
} from '../src/data/taxProfiles';

describe('tax profile catalogue integrity', () => {
  it('has unique country codes', () => {
    const codes = TAX_PROFILES.map((p) => p.countryCode.toUpperCase());
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('uses 2-letter upper-case ISO codes and 3-letter currency codes', () => {
    for (const p of TAX_PROFILES) {
      expect(p.countryCode).toMatch(/^[A-Z]{2}$/);
      expect(p.currency).toMatch(/^[A-Z]{3}$/);
      expect(p.standardRate).toBeGreaterThanOrEqual(0);
      expect(p.reducedRates.every((r) => r >= 0)).toBe(true);
    }
  });

  it('only references regions that exist in the canonical order', () => {
    for (const p of TAX_PROFILES) {
      expect(TAX_REGION_ORDER, `unknown region "${p.region}"`).toContain(p.region);
    }
  });

  it('covers more than a hundred markets', () => {
    expect(taxCoverage().countries).toBeGreaterThan(100);
  });
});

describe('representative standard rates (as of the July 2026 survey)', () => {
  it('pins a spread of well-known regimes', () => {
    expect(taxProfileFor('NG')?.standardRate).toBe(7.5);
    expect(taxProfileFor('KE')?.standardRate).toBe(16);
    expect(taxProfileFor('ZA')?.standardRate).toBe(15);
    expect(taxProfileFor('DE')?.standardRate).toBe(19);
    expect(taxProfileFor('SA')?.standardRate).toBe(15);
    expect(taxProfileFor('AE')?.standardRate).toBe(5);
    expect(taxProfileFor('JP')?.standardRate).toBe(10);
    expect(taxProfileFor('VN')?.standardRate).toBe(10);
  });

  it('captures India as a multi-slab GST and Japan with a reduced food rate', () => {
    const inr = taxProfileFor('IN');
    expect(inr?.type).toBe('GST');
    expect(inr?.reducedRates).toEqual(expect.arrayContaining([5, 12, 28]));
    expect(taxProfileFor('JP')?.reducedRates).toContain(8);
  });

  it('has the highest standard rate in the world (Hungary 27%)', () => {
    expect(taxCoverage().highestRate).toEqual({ country: 'Hungary', rate: 27 });
  });
});

describe('lookup + suggested rate helpers', () => {
  it('resolves case-insensitively and reports unknowns', () => {
    expect(isKnownTaxCountry('de')).toBe(true);
    expect(isKnownTaxCountry('ZZ')).toBe(false);
    expect(isKnownTaxCountry(null)).toBe(false);
    expect(taxProfileFor('zz')).toBeNull();
  });

  it('suggests 0% for tax-free or unknown markets (never a wrong non-zero default)', () => {
    expect(suggestedTaxRateFor('US')).toBe(0); // no federal rate
    expect(suggestedTaxRateFor('QA')).toBe(0); // TAX_FREE
    expect(suggestedTaxRateFor('BW')).toBe(0); // not in the catalogue
    expect(suggestedTaxRateFor('DE')).toBe(19);
    expect(suggestedTaxRateFor(undefined)).toBe(0);
  });
});

describe('taxProfilesByRegion()', () => {
  it('accounts for every profile exactly once and preserves the region order', () => {
    const groups = taxProfilesByRegion();
    const total = groups.reduce((sum, g) => sum + g.profiles.length, 0);
    expect(total).toBe(TAX_PROFILES.length);
    const order = groups.map((g) => g.region);
    const canonical = TAX_REGION_ORDER.filter((r) => order.includes(r));
    expect(order).toEqual(canonical);
  });

  it('sorts profiles alphabetically inside each region', () => {
    for (const g of taxProfilesByRegion()) {
      const names = g.profiles.map((p) => p.country);
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    }
  });
});
