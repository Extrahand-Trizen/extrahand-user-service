/**
 * Play Store review / internal demo: optionally treat specific Firebase UIDs or phone
 * numbers as fully verified in API responses (does not write to Mongo).
 *
 * Configure (user-service env):
 *   PLAY_REVIEW_BYPASS_UIDS=comma,separated,firebase_uids
 *   PLAY_REVIEW_BYPASS_PHONES=comma,separated (+919876543210 or 9876543210)
 */

function parseList(raw: string | undefined): string[] {
  if (!raw || !String(raw).trim()) return [];
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Last 10 digits for comparison when numbers are formatted differently */
function normalizePhoneDigits(phone: string | undefined | null): string | null {
  if (phone == null || typeof phone !== 'string') return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length >= 10) return digits.slice(-10);
  return digits.length > 0 ? digits : null;
}

export function isReviewBypassUid(uid: string | undefined | null): boolean {
  if (uid == null || String(uid).trim() === '') return false;
  const allow = new Set(parseList(process.env.PLAY_REVIEW_BYPASS_UIDS));
  return allow.has(String(uid).trim());
}

export function isReviewBypassPhone(phone: string | undefined | null): boolean {
  const n = normalizePhoneDigits(phone);
  if (!n) return false;
  for (const entry of parseList(process.env.PLAY_REVIEW_BYPASS_PHONES)) {
    const e = normalizePhoneDigits(entry);
    if (e && e === n) return true;
  }
  return false;
}

export function isReviewBypassUser(
  uid: string | undefined | null,
  phone: string | undefined | null
): boolean {
  return isReviewBypassUid(uid) || isReviewBypassPhone(phone);
}

/**
 * Overrides merged into GET /profiles/me JSON so clients treat user as verified.
 */
export function getReviewBypassProfileOverrides(): Record<string, boolean> {
  return {
    isAadhaarVerified: true,
    isPANVerified: true,
    isBankVerified: true,
    isVerified: true,
    reviewBypassActive: true,
  };
}
