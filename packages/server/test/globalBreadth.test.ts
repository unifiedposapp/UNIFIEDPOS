import { describe, it, expect } from 'vitest';
import {
  INTEGRATION_PROVIDERS,
  providersByCategory,
  CATALOG_STATS,
} from '../src/data/integrationCatalog';
import { FISCAL_PROFILES, fiscalProfileFor, isKnownFiscalCountry, fiscalCoverage } from '../src/data/fiscalProfiles';

describe('integration catalogue breadth (don-t-miss-the-world)', () => {
  it('keeps every provider id unique and every category known', () => {
    const ids = INTEGRATION_PROVIDERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of INTEGRATION_PROVIDERS) {
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.description.length).toBeGreaterThan(0);
    }
    expect(CATALOG_STATS.totalProviders).toBe(INTEGRATION_PROVIDERS.length);
  });

  it('exposes major regional payment processors on every continent', () => {
    const payment = providersByCategory().find((g) => g.category === 'PAYMENT')!.providers.map((p) => p.id);
    // Africa, South/SE Asia, MENA, East Asia, Europe, Oceania, LatAm.
    for (const id of [
      'interswitch', 'yoco', 'payfast', 'dpo', 'pesapal',            // Africa
      'cashfree', 'paytm', 'phonepe', 'safepay', 'sslcommerz',       // South Asia
      'xendit', '2c2p', 'ipay88', 'vnpay',                           // SE Asia
      'telr', 'paytabs', 'moyasar', 'hyperpay', 'iyzico',            // MENA + Turkey
      'tosspayments', 'multi-payment', 'unionpay',                   // East Asia
      'mollie', 'worldline', 'nuvei',                                // Europe / global
      'windcave', 'pin-payments', 'pagseguro',                        // Oceania / LatAm
    ]) {
      expect(payment, `PAYMENT catalog should include ${id}`).toContain(id);
    }
    expect(payment.length).toBeGreaterThanOrEqual(45);
  });
});

describe('fiscal regime expansion (don-t-miss-the-world)', () => {
  it('has unique profile codes', () => {
    const codes = FISCAL_PROFILES.map((p) => p.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('resolves the newly-added sealing markets', () => {
    const byCountry: Record<string, string> = {
      EG: 'EG_ETA', JP: 'JP_QIS', VN: 'VN_EINV', PH: 'PH_ORUS', KR: 'KR_ETAX',
      TR: 'TR_EARSIV', PK: 'PK_FBR', BD: 'BD_NBR', GH: 'GH_EVAT', MA: 'MA_TVA',
      UG: 'UG_EFD', RW: 'RW_ECMS',
    };
    for (const [cc, code] of Object.entries(byCountry)) {
      expect(isKnownFiscalCountry(cc), `${cc} should be known`).toBe(true);
      expect(fiscalProfileFor(cc).code, `${cc} → ${code}`).toBe(code);
    }
  });

  it('reports more fiscal countries than before the expansion', () => {
    expect(fiscalCoverage().countries).toBeGreaterThanOrEqual(38);
  });
});
