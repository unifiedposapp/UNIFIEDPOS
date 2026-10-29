/**
 * Age-restricted sales gate (§37 compliance, alcohol/tobacco/pharmacy).
 *
 * The rule every regulator applies is the same: if the basket contains a
 * restricted item, the sale must not complete until someone records a check.
 * This module decides whether the gate is required and whether it is satisfied;
 * the route records the verification as an AgeVerification row (auditable) and
 * stamps the order.
 *
 * Pure: no Prisma, no I/O.
 */

export interface AgePolicy {
  enabled: boolean;
  /** Store default when a product does not carry its own minAge. */
  defaultMinAge: number;
  /** When true an ID document reference must accompany the check. */
  requireId: boolean;
}

export interface RestrictedLine {
  productId: string;
  name?: string;
  ageRestricted?: boolean;
  minAge?: number | null;
  quantity?: number;
}

export interface VerificationInput {
  birthDate?: Date | string | null;
  documentType?: string | null;
  /** SUPERVISOR_OVERRIDE bypasses the birth-date arithmetic, not the policy. */
  method?: string | null;
}

export type AgeGateVerdict =
  | { required: false; satisfied: true; minAge: null; reason: 'NO_RESTRICTED_ITEMS' | 'POLICY_DISABLED' }
  | { required: true; satisfied: false; minAge: number; reason: 'NOT_VERIFIED' | 'UNDERAGE' | 'ID_REQUIRED' }
  | { required: true; satisfied: true; minAge: number; reason: 'VERIFIED' | 'OVERRIDE' };

/** Whole years between birth date and `now`, anniversary-correct. */
export function ageFromBirthDate(birthDate: Date | string, now: Date = new Date()): number | null {
  const b = birthDate instanceof Date ? birthDate : new Date(birthDate);
  if (Number.isNaN(b.getTime())) return null;
  if (b.getTime() > now.getTime()) return null;

  let age = now.getFullYear() - b.getFullYear();
  const hadBirthday =
    now.getMonth() > b.getMonth() || (now.getMonth() === b.getMonth() && now.getDate() >= b.getDate());
  if (!hadBirthday) age -= 1;
  return age;
}

/** The highest minimum age present in the basket, or null when unrestricted. */
export function requiredMinAge(lines: RestrictedLine[], defaultMinAge = 18): number | null {
  let max: number | null = null;
  for (const l of lines ?? []) {
    if (!l.ageRestricted) continue;
    const age = Number(l.minAge) > 0 ? Number(l.minAge) : defaultMinAge;
    max = max === null ? age : Math.max(max, age);
  }
  return max;
}

/**
 * Evaluate the gate.
 *
 * `verification` is omitted when the cashier has not yet asked for ID — that is
 * the normal state on the first attempt, and it yields NOT_VERIFIED so the POS
 * can show the prompt instead of guessing.
 */
export function evaluateAgeGate(
  policy: AgePolicy,
  lines: RestrictedLine[],
  verification?: VerificationInput | null,
  now: Date = new Date(),
): AgeGateVerdict {
  if (!policy.enabled) {
    return { required: false, satisfied: true, minAge: null, reason: 'POLICY_DISABLED' };
  }

  const minAge = requiredMinAge(lines, policy.defaultMinAge);
  if (minAge === null) {
    return { required: false, satisfied: true, minAge: null, reason: 'NO_RESTRICTED_ITEMS' };
  }

  if (!verification) return { required: true, satisfied: false, minAge, reason: 'NOT_VERIFIED' };

  const method = String(verification.method ?? '').toUpperCase();
  if (method === 'SUPERVISOR_OVERRIDE') {
    return { required: true, satisfied: true, minAge, reason: 'OVERRIDE' };
  }

  if (policy.requireId && !verification.documentType) {
    return { required: true, satisfied: false, minAge, reason: 'ID_REQUIRED' };
  }

  if (verification.birthDate) {
    const age = ageFromBirthDate(verification.birthDate, now);
    if (age === null) return { required: true, satisfied: false, minAge, reason: 'UNDERAGE' };
    if (age < minAge) return { required: true, satisfied: false, minAge, reason: 'UNDERAGE' };
    return { required: true, satisfied: true, minAge, reason: 'VERIFIED' };
  }

  // Document shown and accepted at the door, without storing a birth date:
  // the method itself is the attestation.
  if (method === 'MANUAL_DOB' || method === 'ID_SCAN') {
    return { required: true, satisfied: true, minAge, reason: 'VERIFIED' };
  }

  return { required: true, satisfied: false, minAge, reason: 'NOT_VERIFIED' };
}

/** Refusal text for the register, so the cashier sees the same words everywhere. */
export function ageGateMessage(verdict: AgeGateVerdict): string {
  if (!verdict.required || verdict.satisfied) return '';
  switch (verdict.reason) {
    case 'UNDERAGE':
      return `Customer is under ${verdict.minAge}. Sale refused.`;
    case 'ID_REQUIRED':
      return `ID document required for this ${verdict.minAge}+ item.`;
    default:
      return `Age verification required for a ${verdict.minAge}+ item in this basket.`;
  }
}
