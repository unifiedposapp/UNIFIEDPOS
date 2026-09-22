// ─── CUSTOM FIELDS + APP TOKENS ──────────────────────────────────────────────
// A hardware shop needs "Cut Length", a pharmacy needs "Batch", a salon needs
// "Stylist Note". Adding columns per tenant is not something a shared database
// can do safely, so extensions are typed definitions plus an EAV value table —
// and the whole value of that trade-off depends on coercion being strict at the
// edge. A number field that accepts "yes" is how a report silently goes wrong.
import crypto from 'node:crypto';
import { impliedScopes, type AppScope } from '../data/appCatalog.js';

export type CustomDataType = 'TEXT' | 'NUMBER' | 'MONEY' | 'PERCENT' | 'DATE' | 'BOOLEAN' | 'SELECT';
export type CustomEntity = 'ORDER' | 'CUSTOMER' | 'PRODUCT';

export const CUSTOM_DATA_TYPES: CustomDataType[] = ['TEXT', 'NUMBER', 'MONEY', 'PERCENT', 'DATE', 'BOOLEAN', 'SELECT'];
export const CUSTOM_ENTITIES: CustomEntity[] = ['ORDER', 'CUSTOMER', 'PRODUCT'];

export const MAX_TEXT_LENGTH = 2000;
export const MAX_PERCENT = 100;

export interface FieldValidation {
  min?: number | null;
  max?: number | null;
  maxLength?: number | null;
  /** Source string; compiled with a guard so a bad pattern cannot hang a request. */
  pattern?: string | null;
}

export interface FieldDefinition {
  fieldKey: string;
  label: string;
  dataType: CustomDataType;
  required?: boolean;
  options?: string[] | null;
  validation?: FieldValidation | null;
  defaultValue?: string | number | boolean | null;
  active?: boolean;
  sortOrder?: number;
  entity?: CustomEntity;
}

export interface StoredValue {
  textValue?: string | null;
  numberValue?: number | null;
  boolValue?: boolean | null;
  dateValue?: Date | null;
}

export function slugFieldKey(input: unknown): string {
  return String(input ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
}

const RESERVED_KEYS = new Set(['id', 'total', 'subtotal', 'tax', 'status', 'metadata', 'items', 'customfields']);

export interface DefinitionCheck {
  ok: boolean;
  normalized: FieldDefinition;
  errors: { field: string; code: string; message: string }[];
}

/** Validate a definition before it is ever persisted. */
export function validateDefinition(input: Partial<FieldDefinition>): DefinitionCheck {
  const errors: DefinitionCheck['errors'] = [];
  const dataType = String(input.dataType || 'TEXT').toUpperCase() as CustomDataType;
  const entity = String(input.entity || 'ORDER').toUpperCase() as CustomEntity;
  const fieldKey = slugFieldKey(input.fieldKey || input.label);
  const label = String(input.label ?? '').trim();

  if (!label) errors.push({ field: 'label', code: 'MISSING', message: 'a field needs a label' });
  if (label.length > 80) errors.push({ field: 'label', code: 'TOO_LONG', message: 'label must be 80 characters or fewer' });
  if (!fieldKey) errors.push({ field: 'fieldKey', code: 'MISSING', message: 'field key could not be derived from the label' });
  if (RESERVED_KEYS.has(fieldKey.replace(/_/g, ''))) errors.push({ field: 'fieldKey', code: 'RESERVED', message: `${fieldKey} collides with a core order field` });
  if (!CUSTOM_DATA_TYPES.includes(dataType)) errors.push({ field: 'dataType', code: 'BAD_TYPE', message: `unknown data type ${dataType}` });
  if (!CUSTOM_ENTITIES.includes(entity)) errors.push({ field: 'entity', code: 'BAD_ENTITY', message: `unknown entity ${entity}` });

  const options = Array.isArray(input.options) ? input.options.map((o) => String(o).trim()).filter(Boolean) : [];
  if (dataType === 'SELECT') {
    if (options.length < 2) errors.push({ field: 'options', code: 'TOO_FEW_OPTIONS', message: 'a pick list needs at least two choices' });
    if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) errors.push({ field: 'options', code: 'DUPLICATE_OPTION', message: 'choices must be unique' });
  }

  const validation = (input.validation || {}) as FieldValidation;
  if (validation.pattern) {
    try {
      new RegExp(validation.pattern);
    } catch {
      errors.push({ field: 'validation.pattern', code: 'BAD_PATTERN', message: 'regular expression does not compile' });
    }
  }
  if (validation.min != null && validation.max != null && Number(validation.min) > Number(validation.max)) {
    errors.push({ field: 'validation.min', code: 'INVERTED_RANGE', message: 'minimum is above maximum' });
  }
  if (dataType === 'PERCENT' && validation.max != null && Number(validation.max) > MAX_PERCENT) {
    errors.push({ field: 'validation.max', code: 'OVER_100', message: 'a percentage cannot exceed 100' });
  }

  const normalized: FieldDefinition = {
    fieldKey,
    label: label || fieldKey,
    dataType,
    entity,
    required: Boolean(input.required),
    options: dataType === 'SELECT' ? options : null,
    validation: {
      min: validation.min == null ? null : Number(validation.min),
      max: validation.max == null ? null : Number(validation.max),
      maxLength: validation.maxLength == null ? null : Math.min(MAX_TEXT_LENGTH, Math.trunc(Number(validation.maxLength))),
      pattern: validation.pattern || null,
    },
    defaultValue: input.defaultValue ?? null,
    active: input.active !== false,
    sortOrder: Math.max(0, Math.trunc(Number(input.sortOrder) || 0)),
  };

  return { ok: errors.length === 0, normalized, errors };
}

export interface CoercionResult {
  ok: boolean;
  storage: StoredValue;
  /** Canonical value echoed back to the caller for display. */
  value?: string | number | boolean | null;
  reason?: string;
  code?: string;
}

/**
 * Coerce one submitted value into its storage columns. Nothing is silently
 * dropped: an unusable value is a validation error with a code the UI can show.
 */
export function coerceValue(def: FieldDefinition, raw: unknown): CoercionResult {
  const empty = raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '');
  if (empty) {
    if (def.required) return { ok: false, storage: {}, code: 'REQUIRED', reason: `${def.label} is required` };
    return { ok: true, storage: {}, value: null };
  }

  const validation = def.validation || {};
  switch (def.dataType) {
    case 'TEXT': {
      const text = String(raw).trim();
      const max = Math.min(MAX_TEXT_LENGTH, Math.trunc(Number(validation.maxLength) || MAX_TEXT_LENGTH));
      if (text.length > max) return { ok: false, storage: {}, code: 'TOO_LONG', reason: `${def.label} must be ${max} characters or fewer` };
      if (validation.pattern) {
        try {
          if (!new RegExp(validation.pattern).test(text)) return { ok: false, storage: {}, code: 'PATTERN', reason: `${def.label} does not match the required format` };
        } catch {
          /* an uncompilable stored pattern fails open rather than blocking a sale */
        }
      }
      return { ok: true, storage: { textValue: text }, value: text };
    }
    case 'NUMBER':
    case 'MONEY':
    case 'PERCENT': {
      const numeric = typeof raw === 'number' ? raw : Number(String(raw).replace(/[,\s]/g, ''));
      if (!Number.isFinite(numeric)) return { ok: false, storage: {}, code: 'NOT_A_NUMBER', reason: `${def.label} must be a number` };
      const rounded = def.dataType === 'NUMBER' ? Math.round(numeric * 10000) / 10000 : Math.round(numeric * 100) / 100;
      if (validation.min != null && rounded < Number(validation.min)) return { ok: false, storage: {}, code: 'BELOW_MIN', reason: `${def.label} must be at least ${validation.min}` };
      if (validation.max != null && rounded > Number(validation.max)) return { ok: false, storage: {}, code: 'ABOVE_MAX', reason: `${def.label} must be at most ${validation.max}` };
      if (def.dataType === 'PERCENT' && (rounded < 0 || rounded > MAX_PERCENT)) return { ok: false, storage: {}, code: 'OUT_OF_RANGE', reason: `${def.label} must be between 0 and ${MAX_PERCENT}%` };
      if (def.dataType === 'MONEY' && rounded < 0) return { ok: false, storage: {}, code: 'NEGATIVE_MONEY', reason: `${def.label} cannot be negative` };
      return { ok: true, storage: { numberValue: rounded }, value: rounded };
    }
    case 'BOOLEAN': {
      const truthy = raw === true || raw === 1 || ['1', 'true', 'yes', 'y', 'on'].includes(String(raw).toLowerCase());
      const falsy = raw === false || raw === 0 || ['0', 'false', 'no', 'n', 'off', ''].includes(String(raw).toLowerCase());
      if (!truthy && !falsy) return { ok: false, storage: {}, code: 'NOT_A_BOOLEAN', reason: `${def.label} must be yes or no` };
      return { ok: true, storage: { boolValue: truthy }, value: truthy };
    }
    case 'DATE': {
      const parsed = raw instanceof Date ? raw : new Date(String(raw));
      if (!Number.isFinite(parsed.getTime())) return { ok: false, storage: {}, code: 'BAD_DATE', reason: `${def.label} is not a date` };
      return { ok: true, storage: { dateValue: parsed }, value: parsed.toISOString().slice(0, 10) };
    }
    case 'SELECT': {
      const wanted = String(raw).trim();
      const options = (def.options || []).map(String);
      const match = options.find((o) => o.toLowerCase() === wanted.toLowerCase());
      if (!match) return { ok: false, storage: {}, code: 'UNKNOWN_OPTION', reason: `${def.label} must be one of: ${options.join(', ')}` };
      return { ok: true, storage: { textValue: match }, value: match };
    }
    default:
      return { ok: false, storage: {}, code: 'BAD_TYPE', reason: `unknown data type ${def.dataType}` };
  }
}

export interface ApplyResult {
  ok: boolean;
  values: { fieldId?: string; fieldKey: string; storage: StoredValue; value: unknown }[];
  errors: { fieldKey: string; code: string; message: string }[];
  missing: string[];
}

/**
 * Coerce a whole submitted map against the active definitions for an entity.
 * Unknown keys are rejected rather than ignored, because an app that mistyped a
 * field key must find out now, not when the report looks thin.
 */
export function applyValues(defs: FieldDefinition[], submitted: Record<string, unknown>, options: { partial?: boolean } = {}): ApplyResult {
  const active = (defs || []).filter((d) => d.active !== false);
  const errors: ApplyResult['errors'] = [];
  const missing: string[] = [];
  const values: ApplyResult['values'] = [];
  const keys = new Set(active.map((d) => d.fieldKey));

  for (const def of active) {
    const has = Object.prototype.hasOwnProperty.call(submitted || {}, def.fieldKey);
    if (!has) {
      if (def.required && !options.partial) missing.push(def.fieldKey);
      continue;
    }
    const result = coerceValue(def, submitted[def.fieldKey]);
    if (!result.ok) {
      errors.push({ fieldKey: def.fieldKey, code: String(result.code), message: String(result.reason) });
      continue;
    }
    values.push({ fieldKey: def.fieldKey, storage: result.storage, value: result.value ?? null });
  }

  for (const key of Object.keys(submitted || {})) {
    if (!keys.has(key)) errors.push({ fieldKey: key, code: 'UNKNOWN_FIELD', message: `no custom field "${key}" is defined for this entity` });
  }

  return { ok: errors.length === 0 && missing.length === 0, values, errors, missing };
}

/** Read side: turn stored rows back into the flat map the client sent. */
export type DefinedField = FieldDefinition & { id?: string };

export function serializeValues(defs: DefinedField[], rows: { fieldId: string; textValue?: string | null; numberValue?: unknown; boolValue?: boolean | null; dateValue?: Date | null }[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const def of defs || []) {
    const row = rows.find((r) => r.fieldId === def.id);
    if (!row) continue;
    switch (def.dataType) {
      case 'NUMBER':
      case 'MONEY':
      case 'PERCENT':
        out[def.fieldKey] = row.numberValue == null ? null : Number(row.numberValue);
        break;
      case 'BOOLEAN':
        out[def.fieldKey] = row.boolValue ?? null;
        break;
      case 'DATE':
        out[def.fieldKey] = row.dateValue ? new Date(row.dateValue).toISOString().slice(0, 10) : null;
        break;
      default:
        out[def.fieldKey] = row.textValue ?? null;
    }
  }
  return out;
}

/**
 * Default values for a fresh cart, so the cashier sees the extension filled in
 * rather than hunting for it.
 */
export function defaultValues(defs: FieldDefinition[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const def of defs || []) {
    if (def.active === false || def.defaultValue == null || def.defaultValue === '') continue;
    const coerced = coerceValue({ ...def, required: false }, def.defaultValue);
    if (coerced.ok) out[def.fieldKey] = coerced.value;
  }
  return out;
}

// ─── app API tokens ──────────────────────────────────────────────────────────
export interface IssuedToken {
  /** Shown once to the user; never stored. */
  token: string;
  /** What the database keeps: the digest plus a recognizable tail. */
  tokenHash: string;
  preview: string;
  scopes: AppScope[];
}

export function hashAppToken(token: string): string {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

export function issueAppToken(scopes: string[]): IssuedToken {
  const granted = impliedScopes(scopes as AppScope[]);
  const token = `upos_${crypto.randomBytes(20).toString('hex')}`;
  return { token, tokenHash: hashAppToken(token), preview: `${token.slice(0, 9)}…${token.slice(-4)}`, scopes: granted };
}

export function verifyAppToken(token: unknown, storedHash: unknown): boolean {
  if (!token || !storedHash) return false;
  const provided = hashAppToken(String(token));
  const expected = String(storedHash);
  if (provided.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

/** Scope gate for an app-token call: every required scope, not any one of them. */
export function scopesSatisfy(granted: string[] | null | undefined, required: AppScope[]): boolean {
  if (!required?.length) return true;
  const have = new Set(impliedScopes((granted || []) as AppScope[]));
  return required.every((scope) => have.has(scope));
}
