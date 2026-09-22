import { describe, it, expect } from 'vitest';
import {
  slugFieldKey,
  validateDefinition,
  coerceValue,
  applyValues,
  serializeValues,
  defaultValues,
  hashAppToken,
  issueAppToken,
  verifyAppToken,
  scopesSatisfy,
  CUSTOM_DATA_TYPES,
  CUSTOM_ENTITIES,
  MAX_TEXT_LENGTH,
  MAX_PERCENT,
  type FieldDefinition,
} from '../src/services/customFields';
import { impliedScopes, highestRiskScope, appByCode, APP_CATALOG, APP_CODES, ALL_SCOPES, appsForMarket } from '../src/data/appCatalog';
import type { AppScope } from '../src/data/appCatalog';

const def = (overrides: Partial<FieldDefinition> = {}): FieldDefinition => ({
  fieldKey: 'field',
  label: 'Field',
  dataType: 'TEXT',
  ...overrides,
});

/** Definitions arrive as arbitrary JSON from an app; the types only bind us here. */
const raw = (input: Record<string, unknown>) => validateDefinition(input as unknown as Partial<FieldDefinition>);

describe('field keys', () => {
  it('derives a stable, boring identifier from a human label', () => {
    expect(slugFieldKey('Cut Length')).toBe('cut_length');
    expect(slugFieldKey('  Batch #2 !! ')).toBe('batch_2');
    expect(slugFieldKey('Café')).toBe('caf');
    expect(slugFieldKey('already_snake')).toBe('already_snake');
    expect(slugFieldKey(null)).toBe('');
    expect(slugFieldKey(undefined)).toBe('');
    expect(slugFieldKey('')).toBe('');
  });

  it('bounds the key so it cannot outrun a column', () => {
    expect(slugFieldKey('a'.repeat(80))).toHaveLength(48);
  });
});

describe('definition validation', () => {
  it('accepts a plain text field and normalises what the caller left out', () => {
    const check = raw({ label: 'Stylist Note', dataType: 'text' });
    expect(check.ok).toBe(true);
    expect(check.errors).toEqual([]);
    expect(check.normalized).toMatchObject({
      fieldKey: 'stylist_note',
      label: 'Stylist Note',
      dataType: 'TEXT',
      entity: 'ORDER',
      required: false,
      active: true,
      options: null,
      defaultValue: null,
      sortOrder: 0,
    });
    expect(check.normalized.validation).toEqual({ min: null, max: null, maxLength: null, pattern: null });
  });

  it('refuses a field with nothing to name it', () => {
    const check = validateDefinition({ dataType: 'TEXT' });
    expect(check.ok).toBe(false);
    expect(check.errors.map((e) => `${e.field}:${e.code}`)).toEqual(['label:MISSING', 'fieldKey:MISSING']);
  });

  it('protects core order columns from being shadowed', () => {
    expect(validateDefinition({ label: 'Total', dataType: 'NUMBER' }).errors.map((e) => e.code)).toContain('RESERVED');
    expect(validateDefinition({ label: 'Custom Fields', dataType: 'TEXT' }).errors.map((e) => e.code)).toContain('RESERVED');
    expect(validateDefinition({ label: 'Cut Length', dataType: 'NUMBER' }).ok).toBe(true);
  });

  it('rejects unknown types, entities and an over-long label', () => {
    expect(raw({ label: 'X', dataType: 'JSON' }).errors.map((e) => e.code)).toContain('BAD_TYPE');
    expect(raw({ label: 'X', dataType: 'TEXT', entity: 'TILL' }).errors.map((e) => e.code)).toContain('BAD_ENTITY');
    expect(validateDefinition({ label: 'l'.repeat(81), dataType: 'TEXT' }).errors.map((e) => e.code)).toContain('TOO_LONG');
  });

  it('requires a real pick list, case-insensitively', () => {
    expect(validateDefinition({ label: 'Size', dataType: 'SELECT' }).errors.map((e) => e.code)).toContain('TOO_FEW_OPTIONS');
    expect(validateDefinition({ label: 'Size', dataType: 'SELECT', options: ['Small', 'small'] }).errors.map((e) => e.code)).toContain('DUPLICATE_OPTION');
    const ok = validateDefinition({ label: 'Size', dataType: 'SELECT', options: [' Small ', 'Large', ''] });
    expect(ok.ok).toBe(true);
    expect(ok.normalized.options).toEqual(['Small', 'Large']); // blanks trimmed away
    expect(validateDefinition({ label: 'Note', dataType: 'TEXT', options: ['a', 'b'] }).normalized.options).toBeNull();
  });

  it('will not store a pattern that cannot compile', () => {
    expect(validateDefinition({ label: 'Code', dataType: 'TEXT', validation: { pattern: '(' } }).errors.map((e) => e.code)).toContain('BAD_PATTERN');
    expect(validateDefinition({ label: 'Code', dataType: 'TEXT', validation: { pattern: '^\\d{3}$' } }).ok).toBe(true);
  });

  it('catches an inverted or impossible numeric range', () => {
    expect(validateDefinition({ label: 'Qty', dataType: 'NUMBER', validation: { min: 10, max: 5 } }).errors.map((e) => e.code)).toContain('INVERTED_RANGE');
    expect(validateDefinition({ label: 'Tip', dataType: 'PERCENT', validation: { max: 150 } }).errors.map((e) => e.code)).toContain('OVER_100');
    expect(validateDefinition({ label: 'Tip', dataType: 'PERCENT', validation: { max: 100 } }).ok).toBe(true);
  });

  it('clamps the text ceiling and the sort order into the schema', () => {
    const check = validateDefinition({ label: 'Note', dataType: 'TEXT', validation: { maxLength: 99_999 }, sortOrder: -3.7 });
    expect(check.normalized.validation?.maxLength).toBe(MAX_TEXT_LENGTH);
    expect(check.normalized.sortOrder).toBe(0);
    expect(validateDefinition({ label: 'Note', dataType: 'TEXT', sortOrder: 3.7 }).normalized.sortOrder).toBe(3);
  });

  it('publishes the enums the UI builds its dropdowns from', () => {
    expect(CUSTOM_DATA_TYPES).toHaveLength(7);
    expect(CUSTOM_ENTITIES).toEqual(['ORDER', 'CUSTOMER', 'PRODUCT']);
    expect(MAX_PERCENT).toBe(100);
  });
});

describe('value coercion', () => {
  it('treats an empty value as absent, and absent as a failure only when required', () => {
    expect(coerceValue(def(), '')).toEqual({ ok: true, storage: {}, value: null });
    expect(coerceValue(def(), null).storage).toEqual({});
    expect(coerceValue(def({ required: true }), '   ')).toMatchObject({ ok: false, code: 'REQUIRED' });
  });

  it('enforces length and format on text', () => {
    expect(coerceValue(def({ validation: { maxLength: 5 } }), 'abcdef').code).toBe('TOO_LONG');
    expect(coerceValue(def({ validation: { pattern: '^\\d{3}$' } }), '12').code).toBe('PATTERN');
    expect(coerceValue(def({ validation: { pattern: '^\\d{3}$' } }), ' 123 ')).toMatchObject({ ok: true, value: '123' });
    // A stored pattern that later fails to compile must not block a sale.
    expect(coerceValue(def({ validation: { pattern: '(' } }), 'anything').ok).toBe(true);
  });

  it('reads numbers past the separators a human types', () => {
    expect(coerceValue(def({ dataType: 'MONEY' }), '1,234.50').value).toBe(1234.5);
    expect(coerceValue(def({ dataType: 'NUMBER' }), '1 234').value).toBe(1234);
    expect(coerceValue(def({ dataType: 'NUMBER' }), 1.23456).value).toBe(1.2346); // four places
    expect(coerceValue(def({ dataType: 'MONEY' }), 1.23456).value).toBe(1.23); // two places
    expect(coerceValue(def({ dataType: 'NUMBER' }), 'yes').code).toBe('NOT_A_NUMBER');
    expect(coerceValue(def({ dataType: 'NUMBER' }), Infinity).code).toBe('NOT_A_NUMBER');
  });

  it('holds the range, then the type-specific floor', () => {
    expect(coerceValue(def({ dataType: 'NUMBER', validation: { min: 1, max: 10 } }), 0.5).code).toBe('BELOW_MIN');
    expect(coerceValue(def({ dataType: 'NUMBER', validation: { min: 1, max: 10 } }), 20).code).toBe('ABOVE_MAX');
    expect(coerceValue(def({ dataType: 'MONEY' }), -0.01).code).toBe('NEGATIVE_MONEY');
    expect(coerceValue(def({ dataType: 'PERCENT' }), 101).code).toBe('OUT_OF_RANGE');
    expect(coerceValue(def({ dataType: 'PERCENT' }), -1).code).toBe('OUT_OF_RANGE');
    expect(coerceValue(def({ dataType: 'PERCENT' }), 12.5).value).toBe(12.5);
  });

  it('accepts the ways a cashier actually says yes', () => {
    const bool = def({ dataType: 'BOOLEAN' });
    for (const truthy of [true, 1, '1', 'TRUE', 'yes', 'Y', 'on']) expect(coerceValue(bool, truthy).value).toBe(true);
    for (const falsy of [false, 0, '0', 'no', 'N', 'off']) expect(coerceValue(bool, falsy).value).toBe(false);
    expect(coerceValue(bool, 'maybe').code).toBe('NOT_A_BOOLEAN');
  });

  it('parses dates and echoes them as plain days', () => {
    const date = def({ dataType: 'DATE' });
    expect(coerceValue(date, '2026-03-04')).toMatchObject({ ok: true, value: '2026-03-04' });
    expect(coerceValue(date, new Date('2026-03-04T00:00:00Z')).value).toBe('2026-03-04');
    expect(coerceValue(date, 'not-a-date').code).toBe('BAD_DATE');
  });

  it('stores the canonical option casing the merchant defined', () => {
    const select = def({ dataType: 'SELECT', options: ['Small', 'Large'] });
    expect(coerceValue(select, 'small').value).toBe('Small');
    const wrong = coerceValue(select, 'huge');
    expect(wrong.code).toBe('UNKNOWN_OPTION');
    expect(wrong.reason).toContain('Small, Large');
  });

  it('refuses a definition whose type no longer exists', () => {
    expect(coerceValue(def({ dataType: 'IMAGE' as FieldDefinition['dataType'] }), 'x').code).toBe('BAD_TYPE');
  });
});

describe('applying a submitted map', () => {
  const cut = def({ fieldKey: 'cut_length', label: 'Cut Length', dataType: 'NUMBER', required: true });
  const note = def({ fieldKey: 'stylist_note', label: 'Note', dataType: 'TEXT' });
  const retired = def({ fieldKey: 'batch', label: 'Batch', dataType: 'TEXT', active: false });

  it('coerces every active field and skips the retired ones', () => {
    const result = applyValues([cut, note, retired], { cut_length: 5, stylist_note: 'hi', batch: 'x' });
    expect(result.values).toEqual([
      { fieldKey: 'cut_length', storage: { numberValue: 5 }, value: 5 },
      { fieldKey: 'stylist_note', storage: { textValue: 'hi' }, value: 'hi' },
    ]);
    expect(result.ok).toBe(false); // the retired field is not a field any more
    expect(result.errors.map((e) => `${e.code}:${e.fieldKey}`)).toEqual(['UNKNOWN_FIELD:batch']);
  });

  it('demands required fields on a full save and forgives them on a partial one', () => {
    expect(applyValues([cut, note], {})).toMatchObject({ ok: false, missing: ['cut_length'], errors: [] });
    expect(applyValues([cut, note], {}, { partial: true })).toMatchObject({ ok: true, missing: [], values: [] });
  });

  it('surfaces the coercion code against the right field', () => {
    const result = applyValues([cut, note], { cut_length: 'abc' });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([{ fieldKey: 'cut_length', code: 'NOT_A_NUMBER', message: 'Cut Length must be a number' }]);
  });

  it('rejects a mistyped key now rather than a thin report later', () => {
    const result = applyValues([cut], { cut_lenght: 5 });
    expect(result.errors[0].code).toBe('UNKNOWN_FIELD');
    expect(result.values).toEqual([]);
  });

  it('copes with no definitions and no submission at all', () => {
    expect(applyValues([], {})).toEqual({ ok: true, values: [], errors: [], missing: [] });
  });
});

describe('read side', () => {
  const defs = [
    { id: 'f1', fieldKey: 'cut_length', label: 'Cut Length', dataType: 'NUMBER' as const },
    { id: 'f2', fieldKey: 'note', label: 'Note', dataType: 'TEXT' as const },
    { id: 'f3', fieldKey: 'gift', label: 'Gift', dataType: 'BOOLEAN' as const },
    { id: 'f4', fieldKey: 'install_on', label: 'Install', dataType: 'DATE' as const },
    { id: 'f5', fieldKey: 'deposit', label: 'Deposit', dataType: 'MONEY' as const },
  ];
  const rows = [
    { fieldId: 'f1', numberValue: 5 },
    { fieldId: 'f2', textValue: 'hi' },
    { fieldId: 'f3', boolValue: true },
    { fieldId: 'f4', dateValue: new Date('2026-03-04T00:00:00Z') },
    { fieldId: 'f5', numberValue: '12.50' }, // Prisma Decimal arrives as a string
  ];

  it('turns the EAV rows back into the flat map the client sent', () => {
    expect(serializeValues(defs, rows)).toEqual({
      cut_length: 5,
      note: 'hi',
      gift: true,
      install_on: '2026-03-04',
      deposit: 12.5,
    });
  });

  it('omits what was never filled in and nulls out an empty cell', () => {
    expect(serializeValues(defs, [{ fieldId: 'f2', textValue: null }])).toEqual({ note: null });
    expect(serializeValues(defs, [])).toEqual({});
    expect(serializeValues([], rows)).toEqual({});
  });
});

describe('defaults', () => {
  it('pre-fills a fresh cart with what the merchant configured', () => {
    const out = defaultValues([
      def({ fieldKey: 'deposit', label: 'Deposit', dataType: 'MONEY', required: true, defaultValue: '25.00' }),
      def({ fieldKey: 'size', label: 'Size', dataType: 'SELECT', options: ['Small', 'Large'], defaultValue: 'large' }),
      def({ fieldKey: 'note', label: 'Note', dataType: 'TEXT', defaultValue: 'Walk-in' }),
      def({ fieldKey: 'gift', label: 'Gift', dataType: 'BOOLEAN', defaultValue: true }),
    ]);
    expect(out).toEqual({ deposit: 25, size: 'Large', note: 'Walk-in', gift: true });
  });

  it('stays silent rather than shipping a default the field would reject', () => {
    const out = defaultValues([
      def({ fieldKey: 'batch', label: 'Batch', dataType: 'TEXT', defaultValue: '' }),
      def({ fieldKey: 'size', label: 'Size', dataType: 'SELECT', options: ['Small'], defaultValue: 'huge' }),
      def({ fieldKey: 'gone', label: 'Gone', dataType: 'TEXT', defaultValue: 'x', active: false }),
      def({ fieldKey: 'tip', label: 'Tip', dataType: 'PERCENT', defaultValue: 900 }),
    ]);
    expect(out).toEqual({});
  });
});

describe('app tokens', () => {
  it('shows the secret once and keeps only a digest', () => {
    const issued = issueAppToken(['write:orders']);
    expect(/^upos_[0-9a-f]{40}$/.test(issued.token)).toBe(true);
    expect(issued.tokenHash).toBe(hashAppToken(issued.token));
    expect(issued.tokenHash).not.toBe(issued.token);
    expect(issued.preview).toBe(`${issued.token.slice(0, 9)}…${issued.token.slice(-4)}`);
    expect(issued.scopes).toEqual(['read:orders', 'write:orders']);
    expect(issueAppToken(['write:orders']).token).not.toBe(issued.token);
  });

  it('verifies by digest and never by string comparison shortcuts', () => {
    const issued = issueAppToken(['read:reports']);
    expect(verifyAppToken(issued.token, issued.tokenHash)).toBe(true);
    expect(verifyAppToken(`${issued.token}x`, issued.tokenHash)).toBe(false);
    expect(verifyAppToken('', issued.tokenHash)).toBe(false);
    expect(verifyAppToken(issued.token, null)).toBe(false);
    expect(verifyAppToken(undefined, undefined)).toBe(false);
    expect(verifyAppToken(issued.token, 'z'.repeat(64))).toBe(false); // not hex, must not throw
  });

  it('grants a write scope its matching read, and nothing else', () => {
    expect(impliedScopes(['write:orders'])).toEqual(['read:orders', 'write:orders']);
    expect(impliedScopes(['refund:payments'])).toEqual(['read:payments', 'refund:payments']);
    // A write on one resource must never buy visibility on another.
    expect(impliedScopes(['write:orders'])).not.toContain('read:customers');
    expect(impliedScopes(['fiscal:transmit'])).toEqual(['fiscal:transmit']);
    expect(impliedScopes(['webhook:subscribe'])).toEqual(['webhook:subscribe']);
    expect(impliedScopes([])).toEqual([]);
  });

  it('gates a call on every required scope', () => {
    expect(scopesSatisfy(['write:orders'], ['read:orders'])).toBe(true);
    expect(scopesSatisfy(['write:orders'], ['read:orders', 'write:orders'])).toBe(true);
    expect(scopesSatisfy(['write:orders'], ['read:customers'])).toBe(false);
    expect(scopesSatisfy([], ['read:orders'])).toBe(false);
    expect(scopesSatisfy(undefined, [])).toBe(true);
    expect(scopesSatisfy(null, ['read:staff' as AppScope])).toBe(false);
  });

  it('names the scariest thing a grant can do, for the confirmation screen', () => {
    expect(highestRiskScope(['read:reports', 'read:orders'])).toEqual({ scope: 'read:reports', risk: 'LOW' });
    expect(highestRiskScope(['read:orders', 'write:orders'])).toEqual({ scope: 'write:orders', risk: 'MEDIUM' });
    expect(highestRiskScope(['read:orders', 'write:settings', 'refund:payments']).risk).toBe('HIGH');
    expect(highestRiskScope([])).toEqual({ scope: 'read:reports', risk: 'LOW' });
  });
});

describe('catalog integrity', () => {
  it('has one entry per code and something to do with each of them', () => {
    expect(new Set(APP_CODES).size).toBe(APP_CATALOG.length);
    for (const app of APP_CATALOG) {
      expect(app.scopes.length).toBeGreaterThan(0);
      expect(app.endpoints.length).toBeGreaterThan(0);
      expect(app.events.length).toBeGreaterThan(0);
      expect(app.version).toMatch(/\d/);
    }
  });

  it('never lets an app write without saying so', () => {
    for (const app of APP_CATALOG) {
      const mutating = app.scopes.some((s) => s.startsWith('write:') || s.startsWith('refund:') || s === 'fiscal:transmit');
      if (mutating) expect(app.writes, `${app.code} declares ${app.scopes.join(',')} but writes:false`).toBe(true);
    }
  });

  it('looks up case-insensitively and filters by live market', () => {
    expect(appByCode('fiscal_bridge')?.name).toBe('Fiscal Bridge');
    expect(appByCode('NOPE')).toBeNull();
    expect(appByCode(42 as never)).toBeNull();
    expect(appsForMarket(null)).toHaveLength(APP_CODES.length);
    expect(appsForMarket('ZZ').every((a) => !a.markets || a.markets.includes('ZZ'))).toBe(true);
    expect(appsForMarket('ZZ').length).toBeLessThan(APP_CODES.length);
  });

  it('exposes every scope some app actually asks for', () => {
    for (const app of APP_CATALOG) for (const scope of app.scopes) expect(ALL_SCOPES).toContain(scope);
  });
});
