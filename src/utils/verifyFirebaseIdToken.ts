import type { DecodedIdToken } from 'firebase-admin/auth';
import { auth, hasMobileFirebase, mobileAuth } from '../config/firebase';
import logger from '../config/logger';

function decodeJwtPayload(idToken: string): Record<string, unknown> | null {
  try {
    const segment = idToken.split('.')[1];
    if (!segment) return null;
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

export function getFirebaseTokenVerificationHint(idToken: string): string | null {
  const payload = decodeJwtPayload(idToken);
  const audience = typeof payload?.aud === 'string' ? payload.aud : null;
  if (audience === 'extrahand-ca02c' && !hasMobileFirebase) {
    return (
      'Mobile Firebase project (extrahand-ca02c) is not configured on the server. ' +
      'Add FIREBASE_MOBILE_* credentials or serviceAccountKey-mobile.json to extrahand-user-service, then restart.'
    );
  }
  return null;
}

/**
 * Verify a client Firebase ID token against the primary (web) project,
 * then fall back to the mobile project (extrahand-ca02c) when configured.
 */
export async function verifyFirebaseIdToken(idToken: string): Promise<DecodedIdToken> {
  try {
    return await auth.verifyIdToken(idToken);
  } catch (primaryError: unknown) {
    if (!mobileAuth) {
      throw primaryError;
    }

    try {
      const decoded = await mobileAuth.verifyIdToken(idToken);
      logger.info('Verified Firebase ID token with mobile project', {
        aud: decoded.aud,
        uid: decoded.uid,
      });
      return decoded;
    } catch (mobileError: unknown) {
      const primaryMessage =
        primaryError instanceof Error ? primaryError.message : String(primaryError);
      const mobileMessage =
        mobileError instanceof Error ? mobileError.message : String(mobileError);
      logger.error('Invalid ID token for primary and mobile Firebase projects', {
        primary: primaryMessage,
        mobile: mobileMessage,
      });
      throw primaryError;
    }
  }
}
