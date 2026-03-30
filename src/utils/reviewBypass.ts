/**
 * Play Store review / internal demo: optionally treat specific phone numbers, Firebase UIDs,
 * and/or emails as fully verified in API responses (does not write to Mongo).
 *
 * Configure (user-service env):
 *   PLAY_REVIEW_BYPASS_PHONES=comma-separated — e.g. +919999999999,+918888888888 (poster + tasker)
 *   PLAY_REVIEW_BYPASS_UIDS=comma,separated,firebase_uids
 *   PLAY_REVIEW_BYPASS_EMAILS=comma,separated,emails (lowercase match) — test inboxes
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

function normalizeEmail(email: string | undefined | null): string | null {
  if (email == null || typeof email !== 'string') return null;
  const t = email.trim().toLowerCase();
  return t.length > 0 ? t : null;
}

export function isReviewBypassEmail(email: string | undefined | null): boolean {
  const norm = normalizeEmail(email);
  if (!norm) return false;
  for (const entry of parseList(process.env.PLAY_REVIEW_BYPASS_EMAILS)) {
    const e = normalizeEmail(entry);
    if (e && e === norm) return true;
  }
  return false;
}

export function isReviewBypassUser(
  uid: string | undefined | null,
  phone: string | undefined | null,
  email?: string | undefined | null
): boolean {
  return (
    isReviewBypassUid(uid) ||
    isReviewBypassPhone(phone) ||
    isReviewBypassEmail(email)
  );
}

/** ISO timestamp so clients that read `emailVerifiedAt` treat email as verified */
const REVIEW_BYPASS_EMAIL_VERIFIED_AT = '2020-01-01T00:00:00.000Z';

/**
 * Overrides merged into GET /profiles/me JSON so clients treat user as verified.
 */
export function getReviewBypassProfileOverrides(): Record<string, boolean | string> {
  return {
    isAadhaarVerified: true,
    isPANVerified: true,
    isBankVerified: true,
    isVerified: true,
    isEmailVerified: true,
    emailVerifiedAt: REVIEW_BYPASS_EMAIL_VERIFIED_AT,
    reviewBypassActive: true,
  };
}
