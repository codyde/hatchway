import { timingSafeEqual } from 'crypto';

/**
 * Constant-time string comparison. Returns false for unequal-length inputs
 * (timingSafeEqual throws on length mismatch) without leaking length via early
 * return timing beyond what the lengths themselves reveal. Use for comparing
 * secrets/tokens/signatures instead of `===`.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
