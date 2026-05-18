/**
 * Play Store review / internal demo: treat specific phone numbers, Firebase UIDs,
 * and/or emails as fully verified.
 *
 * Configure (user-service env):
 *   PLAY_REVIEW_BYPASS_PHONES=comma-separated — e.g. +919999999999,+918888888888
 *   PLAY_REVIEW_BYPASS_UIDS=comma,separated,firebase_uids
 *   PLAY_REVIEW_BYPASS_EMAILS=comma,separated,emails (lowercase match)
 */

import Profile from '../models/Profile';
import logger from '../config/logger';

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

/** Built-in demo lines (AuthService completeOTPDev + seed-test-user + .env.example). */
const BUILTIN_DEMO_PHONE_LAST10 = new Set([
  '9999999999',
  '8888888888',
  '9876543210',
  '9876543211',
]);

/** Stable demo timestamps (deterministic across logins). */
const DEMO_VERIFIED_AT = new Date('2020-01-01T00:00:00.000Z');
const REVIEW_BYPASS_EMAIL_VERIFIED_AT = '2020-01-01T00:00:00.000Z';

export function isReviewBypassUid(uid: string | undefined | null): boolean {
  if (uid == null || String(uid).trim() === '') return false;
  const trimmed = String(uid).trim();
  if (trimmed.startsWith('local-test-')) return true;
  const allow = new Set(parseList(process.env.PLAY_REVIEW_BYPASS_UIDS));
  return allow.has(trimmed);
}

export function isReviewBypassPhone(phone: string | undefined | null): boolean {
  const n = normalizePhoneDigits(phone);
  if (!n) return false;
  if (BUILTIN_DEMO_PHONE_LAST10.has(n)) return true;
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

/**
 * Fields written to Mongo for demo / review-bypass users (login, signup, self-heal on GET /me).
 */
export function getDemoVerificationPersistPayload(): Record<string, unknown> {
  return {
    isAadhaarVerified: true,
    isPANVerified: true,
    isBankVerified: true,
    isVerified: true,
    isEmailVerified: true,
    emailVerifiedAt: DEMO_VERIFIED_AT,
    aadhaarVerifiedAt: DEMO_VERIFIED_AT,
    panVerifiedAt: DEMO_VERIFIED_AT,
    bankVerifiedAt: DEMO_VERIFIED_AT,
    maskedAadhaar: 'XXXX-XXXX-1234',
    maskedPan: 'XXXXX1234X',
    maskedBankAccount: 'XXXXXX1234',
  };
}

/**
 * Overrides merged into API JSON (includes reviewBypassActive; not stored in Mongo).
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

export function mergeReviewBypassProfile<T extends Record<string, unknown>>(
  profile: T | null | undefined
): T | null | undefined {
  if (!profile) return profile;
  const uid = profile.uid as string | undefined;
  const phone = profile.phone as string | undefined;
  const email = profile.email as string | undefined;
  if (!isReviewBypassUser(uid, phone, email)) return profile;
  return {
    ...profile,
    ...getReviewBypassProfileOverrides(),
    maskedAadhaar: profile.maskedAadhaar ?? 'XXXX-XXXX-1234',
    maskedPan: profile.maskedPan ?? 'XXXXX1234X',
    maskedBankAccount: profile.maskedBankAccount ?? 'XXXXXX1234',
    aadhaarVerifiedAt: profile.aadhaarVerifiedAt ?? DEMO_VERIFIED_AT,
    panVerifiedAt: profile.panVerifiedAt ?? DEMO_VERIFIED_AT,
    bankVerifiedAt: profile.bankVerifiedAt ?? DEMO_VERIFIED_AT,
  } as T;
}

function profileNeedsDemoVerificationPersist(profile: {
  isAadhaarVerified?: boolean;
  isPANVerified?: boolean;
  isBankVerified?: boolean;
  isVerified?: boolean;
  isEmailVerified?: boolean;
}): boolean {
  return (
    !profile.isAadhaarVerified ||
    !profile.isPANVerified ||
    !profile.isBankVerified ||
    !profile.isVerified ||
    !profile.isEmailVerified
  );
}

/**
 * For demo users: persist verified flags in Mongo (if needed) and return merged profile for responses.
 */
export async function ensureDemoVerificationProfile(profile: any): Promise<any> {
  if (!profile?.uid) return profile;
  const uid = String(profile.uid);
  const phone = profile.phone as string | undefined;
  const email = profile.email as string | undefined;
  if (!isReviewBypassUser(uid, phone, email)) return profile;

  const plain = typeof profile.toObject === 'function' ? profile.toObject() : { ...profile };

  if (profileNeedsDemoVerificationPersist(plain)) {
    const payload = getDemoVerificationPersistPayload();
    await Profile.updateOne({ uid }, { $set: payload });
    logger.info('Persisted demo verification flags for review-bypass user', { uid });
    Object.assign(plain, payload);
  }

  return mergeReviewBypassProfile(plain);
}
