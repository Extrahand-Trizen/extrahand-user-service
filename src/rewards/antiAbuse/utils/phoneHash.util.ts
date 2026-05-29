import crypto from 'crypto';
import { normalizePhoneToLast10 } from '../../../utils/identityReconciliation';

const FALLBACK_PEPPER = 'referral-phone-hash-v1';

function resolvePepper(): string {
  const secret =
    process.env.REFERRAL_PHONE_HASH_SECRET?.trim() ||
    process.env.SERVICE_AUTH_TOKEN?.trim() ||
    process.env.ACCESS_TOKEN_SECRET?.trim() ||
    FALLBACK_PEPPER;
  return secret;
}

/** Normalized 10-digit Indian mobile → irreversible HMAC (survives account deletion). */
export function hashReferralPhone(phone?: string | null): string | null {
  const last10 = normalizePhoneToLast10(phone);
  if (!last10) return null;
  return crypto.createHmac('sha256', resolvePepper()).update(last10, 'utf8').digest('hex');
}

export function requireReferralPhoneHash(phone?: string | null): string {
  const hash = hashReferralPhone(phone);
  if (!hash) {
    throw new Error('Verified phone number is required for referral rewards');
  }
  return hash;
}
