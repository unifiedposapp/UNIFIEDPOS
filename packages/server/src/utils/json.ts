// ─── Prisma JSON column helpers ──────────────────────────────────────────────
// Prisma types its Json columns as `InputJsonValue`, whose object form carries an
// index signature. A domain interface (`MandateLine`, `PosHints`, a Zod-derived
// `Record<string, unknown>`) has exactly the same runtime shape but no index
// signature, so TypeScript rejects it. These helpers do the one safe thing: take
// a value that already came from a serializable source and normalise it through
// JSON, so the compiler sees a genuine JSON tree instead of a nominal interface.

import { Prisma } from '@prisma/client';

export type NullableJson = Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue;

/** Serialisable copy of a value, typed for a required Json column. */
export function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/** Same, but writes SQL NULL for null/undefined on a nullable `Json?` column. */
export function jsonOrNull(value: unknown): NullableJson {
  return value == null ? Prisma.DbNull : toJson(value);
}
