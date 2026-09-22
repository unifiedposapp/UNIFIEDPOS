import { describe, it, expect } from 'vitest';
import {
  digitsOnly,
  stripSpacesUpper,
  validateIban,
  ibanCountry,
  validateBic,
  validateUsRouting,
  validateRoutingAccount,
  validateSortCodeAccount,
  validateClabe,
  validateCpf,
  validateCnpj,
  validateUpiVpa,
  validateIfscAccount,
  validateBsbAccount,
  validateNuban,
  validateE164,
  validateTillNumber,
  validatePixKey,
  validateRailIdentifier,
  isKnownIdentifierKind,
  addBusinessDays,
  railFee,
  withinRailLimit,
  chooseRail,
} from '../src/services/paymentRails';

describe('helpers', () => {
  it('strips to digits and to canonical uppercase', () => {
    expect(digitsOnly('ab12-34 cd')).toBe('1234');
    expect(stripSpacesUpper(' gb82 west 1234-5678 ')).toBe('GB82WEST12345678');
  });
});

describe('IBAN (ISO 13616 mod-97)', () => {
  it('accepts a well-formed British and German IBAN, ignoring spacing', () => {
    expect(validateIban('gb82 west 1234 5698 7654 32').valid).toBe(true);
    expect(validateIban('gb82west12345698765432').normalized).toBe('GB82WEST12345698765432');
    expect(validateIban('DE89 3704 0044 0532 0130 00').valid).toBe(true);
  });

  it('rejects a broken check digit rather than a pretty format', () => {
    const bad = validateIban('GB82WEST12345698765433');
    expect(bad.valid).toBe(false);
    expect(bad.reason).toBe('CHECK_DIGIT');
  });

  it('rejects nonsense and empties with distinct codes', () => {
    expect(validateIban('').reason).toBe('MISSING');
    expect(validateIban('1234567890123456').reason).toBe('BAD_FORMAT');
  });

  it('reads the country out of the header', () => {
    expect(ibanCountry('de89370400440532013000')).toBe('DE');
    expect(ibanCountry('  gb82west 1234 5698 7654 32  ')).toBe('GB');
    expect(ibanCountry('1234567890123456')).toBeNull(); // digits carry no country
    expect(ibanCountry('')).toBeNull();
    expect(ibanCountry(null)).toBeNull();
  });
});

describe('SWIFT / BIC', () => {
  it('takes 8 or 11 characters', () => {
    expect(validateBic('DEUTDEFF').valid).toBe(true);
    expect(validateBic('DEUT DEFF 500').normalized).toBe('DEUTDEFF500');
    expect(validateBic('DEUT').reason).toBe('BAD_FORMAT');
  });
});

describe('US ACH routing (3-7-1)', () => {
  it('validates the checksum', () => {
    expect(validateUsRouting('021000021').valid).toBe(true);
    expect(validateUsRouting('021000021').normalized).toBe('021000021');
    expect(validateUsRouting('021000022').reason).toBe('CHECK_DIGIT');
    expect(validateUsRouting('1234').reason).toBe('LENGTH');
    expect(validateUsRouting('999999999').reason).toBe('BAD_FORMAT');
  });

  it('checks both halves of routing:account', () => {
    expect(validateRoutingAccount('021000021:123456789').valid).toBe(true);
    expect(validateRoutingAccount('021000022:123456789').reason).toBe('CHECK_DIGIT');
    expect(validateRoutingAccount('021000021').reason).toBe('BAD_FORMAT');
    expect(validateRoutingAccount('021000021:12').reason).toBe('LENGTH');
  });
});

describe('UK / MX / BR / NG / IN / AU identifiers', () => {
  it('sort code + account', () => {
    expect(validateSortCodeAccount('040076:12345678').valid).toBe(true);
    expect(validateSortCodeAccount('40076:12345678').reason).toBe('BAD_FORMAT');
    expect(validateSortCodeAccount('000000:12345678').reason).toBe('BAD_FORMAT');
    expect(validateSortCodeAccount('040076:12345').reason).toBe('LENGTH');
  });

  it('CLABE mod-10', () => {
    expect(validateClabe('012180000000000002').valid).toBe(true);
    expect(validateClabe('012180000000000003').reason).toBe('CHECK_DIGIT');
    expect(validateClabe('01218000000000002').reason).toBe('LENGTH');
  });

  it('CPF double check digit', () => {
    expect(validateCpf('529.982.247-25').valid).toBe(true);
    expect(validateCpf('52998224725').normalized).toBe('52998224725');
    expect(validateCpf('52998224726').reason).toBe('CHECK_DIGIT');
    expect(validateCpf('11111111111').reason).toBe('BAD_FORMAT');
    expect(validateCpf('5299822472').reason).toBe('LENGTH');
  });

  it('CNPJ double check digit', () => {
    expect(validateCnpj('11.222.333/0001-81').valid).toBe(true);
    expect(validateCnpj('11222333000182').reason).toBe('CHECK_DIGIT');
  });

  it('UPI VPA is handle@bank', () => {
    expect(validateUpiVpa('9876543210@ybl').valid).toBe(true);
    expect(validateUpiVpa('9876543210').reason).toBe('BAD_FORMAT');
  });

  it('IFSC + account', () => {
    expect(validateIfscAccount('HDFC0001234:000012345678').valid).toBe(true);
    expect(validateIfscAccount('HDFC1001234:000012345678').reason).toBe('BAD_FORMAT');
  });

  it('BSB + account', () => {
    expect(validateBsbAccount('062000:12345678').valid).toBe(true);
    expect(validateBsbAccount('06200:12345678').reason).toBe('BAD_FORMAT');
  });

  it('NUBAN mod-11, with or without the leading digit', () => {
    expect(validateNuban('0123456780').valid).toBe(true);
    expect(validateNuban('10123456780').valid).toBe(true);
    expect(validateNuban('0123456781').reason).toBe('CHECK_DIGIT');
    expect(validateNuban('012345678901').reason).toBe('LENGTH');
  });

  it('MSISDN and till numbers', () => {
    // Every separator a human can type, none of which belong in the address.
    expect(validateE164('+55 (11) 99887-7665').normalized).toBe('+5511998877665');
    expect(validateE164('+55 (11) 99887-7665').valid).toBe(true);
    expect(validateE164('00 44 1234 56789').valid).toBe(true);
    expect(validateE164('12345').reason).toBe('BAD_FORMAT');
    expect(validateE164('+1 (555) 12345678901234567').reason).toBe('BAD_FORMAT'); // past 15 digits
    expect(validateTillNumber('ab 12345').valid).toBe(true);
    expect(validateTillNumber('41123').valid).toBe(true);
    expect(validateTillNumber('ABC12345').reason).toBe('BAD_FORMAT');
  });
});

describe('PIX keys are typed', () => {
  it('validates the right thing for the declared key type', () => {
    expect(validatePixKey('52998224725', 'CPF').valid).toBe(true);
    expect(validatePixKey('11222333000181', 'CNPJ').valid).toBe(true);
    expect(validatePixKey('11998877665', 'PHONE').normalized).toBe('+5511998877665');
    expect(validatePixKey('(11) 99887-7665', 'PHONE')).toMatchObject({ valid: true, normalized: '+5511998877665' });
    expect(validatePixKey('+5511998877665', 'PHONE').normalized).toBe('+5511998877665');
    expect(validatePixKey('Joao@Example.com', 'EMAIL').normalized).toBe('joao@example.com');
    expect(validatePixKey('123e4567-e12b-4321-8b4c-4455dd66aa77', 'RANDOM').valid).toBe(true);
    expect(validatePixKey('not-a-uuid', 'RANDOM').reason).toBe('BAD_FORMAT');
  });

  it('guesses the kind when none was declared, rather than failing a valid key', () => {
    expect(validatePixKey('52998224725').valid).toBe(true);
    expect(validatePixKey('joao@example.com').valid).toBe(true);
    expect(validatePixKey('nonsense').reason).toBe('BAD_FORMAT');
  });
});

describe('identifier dispatch', () => {
  it('routes each kind to its own validator', () => {
    expect(validateRailIdentifier('IBAN', 'DE89370400440532013000').valid).toBe(true);
    expect(validateRailIdentifier('ROUTING_ACCOUNT', '021000021:123456789').valid).toBe(true);
    expect(validateRailIdentifier('PIX_KEY', '52998224725', 'CPF').valid).toBe(true);
    expect(validateRailIdentifier('SWIFT_BIC', 'DEUTDEFF:123456').valid).toBe(true);
    expect(validateRailIdentifier('FREEFORM', 'abc').valid).toBe(true);
    expect(validateRailIdentifier('FREEFORM', 'ab').reason).toBe('LENGTH');
  });

  it('refuses an unknown kind instead of wave-through-by-accident', () => {
    const result = validateRailIdentifier('BITCOIN_ADDRESS', 'bc1q…');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('UNKNOWN_KIND');
    expect(isKnownIdentifierKind('IBAN')).toBe(true);
    expect(isKnownIdentifierKind('BITCOIN_ADDRESS')).toBe(false);
  });
});

describe('settlement timing + fees', () => {
  it('adds business days across a weekend', () => {
    // Built in local time because the function walks calendar days.
    const friday = new Date(2026, 2, 6); // Friday 6 March 2026
    expect(friday.getDay()).toBe(5);
    const next = addBusinessDays(friday, 1);
    expect(next.getDate()).toBe(9); // Monday
    expect(next.getDay()).toBe(1);
    expect(addBusinessDays(friday, 0).getDate()).toBe(6);
  });

  it('computes percent plus fixed', () => {
    expect(railFee(1000, { percent: 2.9, fixed: 0.3 })).toBe(29.3);
    expect(railFee(1000, { percent: 0, fixed: 0.25 })).toBe(0.25);
  });

  it('honours a per-transaction ceiling only when the rail sets one', () => {
    expect(withinRailLimit({ maxAmount: 100000 }, 99_999)).toBe(true);
    expect(withinRailLimit({ maxAmount: 100000 }, 100_001)).toBe(false);
    expect(withinRailLimit({}, 10_000_000)).toBe(true);
  });

  it('prefers the instant rail, and drops rails that cannot carry the amount or currency', () => {
    const rails = [
      { code: 'SEPA', instant: false, settlementDays: 1, currencies: ['EUR'], maxAmount: 100_000 },
      { code: 'SEPA_INST', instant: true, settlementDays: 0, currencies: ['EUR'], maxAmount: 100_000 },
      { code: 'SWIFT', instant: false, settlementDays: 2, currencies: ['USD', 'EUR'], maxAmount: null },
    ];
    expect(chooseRail(rails, 500, 'EUR')?.code).toBe('SEPA_INST');
    // Above the two capped rails' ceilings, only the uncapped one can carry it.
    expect(chooseRail(rails, 500_000, 'EUR')?.code).toBe('SWIFT');
    // Same amount, but where the standard rail has no ceiling it beats SWIFT.
    expect(
      chooseRail(
        [
          { code: 'ACH', instant: false, settlementDays: 2, currencies: ['USD'], maxAmount: null },
          { code: 'SAME_FED', instant: true, settlementDays: 0, currencies: ['USD'], maxAmount: 100_000 },
        ],
        250_000,
        'USD'
      )?.code
    ).toBe('ACH');
    expect(chooseRail(rails, 500, 'USD')?.code).toBe('SWIFT');
    expect(chooseRail(rails, 500, 'GBP')).toBeNull();
  });
});
