import { describe, it, expect } from 'vitest';
import {
  PAYMENT_METHOD_CATALOG,
  PAYMENT_METHOD_CATEGORIES,
  PAYMENT_METHOD_IDS,
  PAYMENT_METHOD_ALIASES,
  isValidPaymentMethod,
  normalizePaymentMethod,
  isGatewayMethod,
  isInternalMethod,
  paymentMethodsForCountry,
  methodsByCategory,
  PAYMENT_METHOD_STATS,
} from '../src/data/paymentMethods';
import { ALL_COUNTRY_CODES, CODES_BY_CONTINENT, CONTINENT_ORDER } from '../src/data/globalRegions';

describe('global payment-methods catalog integrity', () => {
  it('has no duplicate ids', () => {
    const ids = PAYMENT_METHOD_CATALOG.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses only upper-snake ids', () => {
    for (const m of PAYMENT_METHOD_CATALOG) expect(m.id).toMatch(/^[A-Z0-9_]+$/);
  });

  it('assigns every method a known category, and every category has methods', () => {
    for (const m of PAYMENT_METHOD_CATALOG) expect(PAYMENT_METHOD_CATEGORIES).toContain(m.category);
    expect(methodsByCategory().length).toBe(PAYMENT_METHOD_CATEGORIES.length);
  });

  it('aliases resolve to valid canonical ids and never collide with a real id', () => {
    for (const [alias, canonical] of Object.entries(PAYMENT_METHOD_ALIASES)) {
      expect(PAYMENT_METHOD_IDS.has(canonical), `${alias} -> ${canonical}`).toBe(true);
      expect(PAYMENT_METHOD_IDS.has(alias), `alias ${alias} must not also be a real id`).toBe(false);
    }
  });

  it('includes the major methods a global merchant expects (nothing obvious missing)', () => {
    for (const id of [
      'VISA', 'MASTERCARD', 'AMERICAN_EXPRESS', 'UNIONPAY', 'JCB', 'DISCOVER', 'RUPAY', 'ELO', 'TROY', 'MIR',
      'APPLE_PAY', 'GOOGLE_PAY', 'SAMSUNG_PAY', 'PAYPAL', 'ALIPAY', 'WECHAT_PAY', 'MERCADO_PAGO', 'PAYTM', 'GCASH', 'DANA', 'MADA',
      'PIX', 'UPI', 'PROMPTPAY', 'PAYNOW', 'FPS', 'BIZUM', 'SPEI', 'FEDNOW', 'SBP',
      'QR', 'QRIS', 'EMV_QR',
      'ACH', 'SEPA_CREDIT_TRANSFER', 'IDEAL', 'SOFORT', 'GIROPAY', 'PRZELEWY24', 'BLIK', 'TRUSTLY', 'FASTER_PAYMENTS', 'INTERAC',
      'KLARNA', 'AFTERPAY', 'AFFIRM', 'ATOME', 'TAMARA', 'TABBY', 'SCALAPAY',
      'M_PESA', 'MTN_MOMO', 'AIRTEL_MONEY', 'ORANGE_MONEY', 'WAVE', 'BKASH', 'JAZZCASH', 'OPAY', 'ECOCASH',
      'BOLETO', 'OXXO', 'KONBINI', 'PAYSAFE_CARD',
      'BITCOIN', 'ETHEREUM', 'USDC', 'USDT', 'LITECOIN', 'SOLANA',
      'CASH', 'GIFT_CARD', 'STORE_CREDIT', 'LOYALTY_POINTS', 'CHEQUE', 'INVOICE', 'OTHER',
    ]) {
      expect(isValidPaymentMethod(id), `${id} should exist`).toBe(true);
    }
  });
});

describe('payment-method routing (gateway vs internal ledger)', () => {
  it('routes card / wallet / online methods through the PSP', () => {
    for (const id of ['CARD', 'VISA', 'TAP', 'APPLE_PAY', 'GOOGLE_PAY', 'QR', 'PIX', 'UPI', 'M_PESA', 'BITCOIN', 'KLARNA', 'IDEAL']) {
      expect(isGatewayMethod(id), id).toBe(true);
    }
  });

  it('keeps cash / store-value / offline on the internal ledger', () => {
    for (const id of ['CASH', 'GIFT_CARD', 'STORE_CREDIT', 'LOYALTY_POINTS', 'CHEQUE', 'INVOICE', 'DEFERRED', 'OTHER', 'WIRE_TRANSFER']) {
      expect(isInternalMethod(id), id).toBe(true);
    }
  });

  it('folds aliases before routing and defaults unknown methods to internal', () => {
    expect(isGatewayMethod('CONTACTLESS')).toBe(true); // -> TAP
    expect(isGatewayMethod('BTC')).toBe(true);          // -> BITCOIN
    expect(isGatewayMethod('AMEX')).toBe(true);         // -> AMERICAN_EXPRESS
    expect(isGatewayMethod('TOTALLY_UNKNOWN')).toBe(false);
  });
});

describe('payment-method validation & normalisation', () => {
  it('validates known ids case-insensitively and rejects unknown / non-strings', () => {
    expect(isValidPaymentMethod('visa')).toBe(true);
    expect(isValidPaymentMethod('PIX')).toBe(true);
    expect(isValidPaymentMethod('NOPE')).toBe(false);
    expect(isValidPaymentMethod(123 as unknown)).toBe(false);
  });

  it('normalises input and folds aliases, rejecting unknown', () => {
    expect(normalizePaymentMethod(' contactless ')).toBe('TAP');
    expect(normalizePaymentMethod('amex')).toBe('AMERICAN_EXPRESS');
    expect(normalizePaymentMethod('btc')).toBe('BITCOIN');
    expect(normalizePaymentMethod('pix')).toBe('PIX');
    expect(normalizePaymentMethod('nope')).toBeNull();
    expect(normalizePaymentMethod(undefined)).toBeNull();
  });
});

describe('worldwide coverage — no country or continent left out', () => {
  it('offers payment methods in EVERY ISO market (249/249)', () => {
    for (const cc of ALL_COUNTRY_CODES) {
      expect(paymentMethodsForCountry(cc).length, cc).toBeGreaterThan(0);
    }
  });

  it('surfaces the right regional methods per market', () => {
    const idsFor = (cc: string) => new Set(paymentMethodsForCountry(cc).map((m) => m.id));
    expect(idsFor('BR').has('PIX') && idsFor('BR').has('BOLETO') && idsFor('BR').has('ELO')).toBe(true);
    expect(idsFor('IN').has('UPI') && idsFor('IN').has('RUPAY') && idsFor('IN').has('PAYTM')).toBe(true);
    expect(idsFor('KE').has('M_PESA')).toBe(true);
    expect(idsFor('NG').has('MTN_MOMO') && idsFor('NG').has('OPAY')).toBe(true);
    expect(idsFor('NL').has('IDEAL')).toBe(true);
    expect(idsFor('DE').has('GIROPAY') && idsFor('DE').has('SOFORT')).toBe(true);
    expect(idsFor('US').has('ACH') && idsFor('US').has('VENMO') && idsFor('US').has('FEDNOW')).toBe(true);
    expect(idsFor('CN').has('ALIPAY') && idsFor('CN').has('WECHAT_PAY') && idsFor('CN').has('UNIONPAY')).toBe(true);
    expect(idsFor('JP').has('KONBINI') && idsFor('JP').has('PAYPAY')).toBe(true);
    expect(idsFor('TH').has('PROMPTPAY') && idsFor('TH').has('TRUEMONEY')).toBe(true);
    expect(idsFor('SG').has('PAYNOW') && idsFor('SG').has('ATOME')).toBe(true);
  });

  it('includes worldwide methods (cards + cash) for every market', () => {
    for (const cc of ['US', 'BR', 'IN', 'NG', 'DE', 'JP', 'AU', 'ZA', 'AE', 'SG']) {
      const ids = new Set(paymentMethodsForCountry(cc).map((m) => m.id));
      expect(ids.has('VISA') && ids.has('MASTERCARD') && ids.has('CASH'), cc).toBe(true);
    }
  });

  it('has region-specific methods on every inhabited continent', () => {
    const regional = PAYMENT_METHOD_CATALOG.filter((m) => m.countries && m.countries.length);
    for (const continent of CONTINENT_ORDER) {
      if (continent === 'Antarctica') continue; // no consumer payment rails
      const codes = new Set(CODES_BY_CONTINENT[continent] || []);
      const hit = regional.some((m) => (m.countries || []).some((c) => codes.has(c)));
      expect(hit, `${continent} should have regional payment methods`).toBe(true);
    }
  });

  it('reports internally consistent stats', () => {
    expect(PAYMENT_METHOD_STATS.totalMethods).toBe(PAYMENT_METHOD_CATALOG.length);
    expect(PAYMENT_METHOD_STATS.gatewayMethods + PAYMENT_METHOD_STATS.internalMethods).toBe(PAYMENT_METHOD_STATS.totalMethods);
    expect(PAYMENT_METHOD_STATS.worldwideMethods + PAYMENT_METHOD_STATS.regionalMethods).toBe(PAYMENT_METHOD_STATS.totalMethods);
  });
});
