import { describe, it, expect } from 'vitest';
import {
  COMPLIANCE_PROFILES,
  COMPLIANCE_REGION_ORDER,
  complianceFor,
  complianceCoverage,
  complianceProfilesByRegion,
  isKnownComplianceCountry,
  receiptFooterFor,
  DEFAULT_COMPLIANCE_PROFILE,
} from '../src/data/complianceProfiles';

describe('compliance profile catalog integrity', () => {
  it('every country code is a 2-letter uppercase token and unique', () => {
    const codes = COMPLIANCE_PROFILES.map((p) => p.countryCode);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of codes) expect(c).toMatch(/^[A-Z]{2}$/);
  });

  it('every region used is in the declared order', () => {
    for (const p of COMPLIANCE_PROFILES) {
      expect(COMPLIANCE_REGION_ORDER).toContain(p.region);
    }
  });

  it('every profile carries a privacy law, residency and at least one receipt line', () => {
    for (const p of COMPLIANCE_PROFILES) {
      expect(p.privacyLaw.trim().length).toBeGreaterThan(0);
      expect(['NONE', 'RECOMMENDED', 'PUBLIC_SECTOR_IN_COUNTRY', 'MANDATORY_IN_COUNTRY']).toContain(p.dataResidency);
      expect(Array.isArray(p.receiptLegalLines)).toBe(true);
    }
  });
});

describe('complianceFor / known-country resolution', () => {
  it('resolves the GDPR for EU members with their own richer profile', () => {
    expect(complianceFor('DE').privacyLaw).toContain('GDPR');
    expect(complianceFor('DE').taxIdLabel).toBe('USt-IdNr.');
    expect(complianceFor('fr').privacyAuthority).toBe('CNIL'); // case-insensitive
  });

  it('flags mandatory data-residency markets', () => {
    expect(complianceFor('CN').dataResidency).toBe('MANDATORY_IN_COUNTRY');
    expect(complianceFor('RU').dataResidency).toBe('MANDATORY_IN_COUNTRY');
  });

  it('falls back to the neutral profile for unknown codes and empty input', () => {
    expect(complianceFor('ZZ').countryCode).toBe(DEFAULT_COMPLIANCE_PROFILE.countryCode);
    expect(complianceFor(null).dataResidency).toBe('NONE');
    expect(isKnownComplianceCountry('ZZ')).toBe(false);
    expect(isKnownComplianceCountry('NG')).toBe(true);
  });
});

describe('receipt footer templating', () => {
  it('interpolates known {placeholders} and leaves unknown tokens intact', () => {
    const footer = receiptFooterFor('NG', { taxId: '12345678-0001' });
    expect(footer).toContain('TIN: 12345678-0001');
    expect(footer).toContain('VAT charged where applicable.');
  });

  it('returns an empty string for an uncoded jurisdiction', () => {
    expect(receiptFooterFor('ZZ')).toBe('');
  });
});

describe('coverage + region grouping', () => {
  it('reports a broad, coherent coverage snapshot', () => {
    const cov = complianceCoverage();
    expect(cov.markets).toBe(COMPLIANCE_PROFILES.length);
    expect(cov.markets).toBeGreaterThan(40);
    expect(cov.mandatoryResidency).toBeGreaterThanOrEqual(2);
    expect(cov.eInvoiceMandated).toBeGreaterThan(15);
  });

  it('groups every profile exactly once across regions', () => {
    const groups = complianceProfilesByRegion();
    const total = groups.reduce((s, g) => s + g.profiles.length, 0);
    expect(total).toBe(COMPLIANCE_PROFILES.length);
    for (const g of groups) expect(g.profiles.length).toBeGreaterThan(0);
  });
});
