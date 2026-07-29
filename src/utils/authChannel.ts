import Profile from '../models/Profile';
import logger from '../config/logger';

/**
 * Product surface that completed auth. Orthogonal to clientType (web|mobile).
 * Used to ensure the matching capability without stripping the other role.
 * Callers must only pass authChannel when clientType === 'mobile'.
 */
export type AuthChannel = 'customer_app' | 'helper_app';

export function parseAuthChannel(raw: unknown): AuthChannel | undefined {
  if (raw == null) return undefined;
  const value = String(raw).trim().toLowerCase().replace(/-/g, '_');
  if (value === 'customer_app' || value === 'customerapp') return 'customer_app';
  if (value === 'helper_app' || value === 'helperapp') return 'helper_app';
  return undefined;
}

function roleForAuthChannel(channel: AuthChannel): 'poster' | 'tasker' {
  return channel === 'helper_app' ? 'tasker' : 'poster';
}

/** Dialog / Meta welcome mapping for each mobile app binary. */
export function welcomeWhatsAppForAuthChannel(channel: AuthChannel): {
  eventKey: 'CUSTOMER_WELCOME' | 'HELPER_WELCOME';
  metaTemplateName: 'extrahand_customer_welcome' | 'extrahand_helper_welcome';
  legacyTemplateKey: 'wa_customer_welcome' | 'wa_helper_welcome';
  role: 'poster' | 'helper';
  idempotencyKey: (uid: string) => string;
} {
  if (channel === 'helper_app') {
    return {
      eventKey: 'HELPER_WELCOME',
      metaTemplateName: 'extrahand_helper_welcome',
      legacyTemplateKey: 'wa_helper_welcome',
      role: 'helper',
      idempotencyKey: (uid) => `welcome:helper:${uid}`,
    };
  }
  return {
    eventKey: 'CUSTOMER_WELCOME',
    metaTemplateName: 'extrahand_customer_welcome',
    legacyTemplateKey: 'wa_customer_welcome',
    role: 'poster',
    idempotencyKey: (uid) => `welcome:customer:${uid}`,
  };
}

export function rolesHaveCapability(
  rolesRaw: unknown,
  capability: 'poster' | 'tasker'
): boolean {
  const roles = Array.isArray(rolesRaw)
    ? rolesRaw.map((r) => String(r || '').trim().toLowerCase()).filter(Boolean)
    : [];

  if (roles.includes('both')) return true;

  if (capability === 'poster') {
    return (
      roles.includes('poster') ||
      roles.includes('requester') ||
      roles.includes('customer')
    );
  }

  return (
    roles.includes('tasker') ||
    roles.includes('helper') ||
    roles.includes('performer')
  );
}

/**
 * Ensure the profile has the capability for this auth channel via $addToSet.
 * Never removes the other role.
 * No-op when:
 * - authChannel is missing/unknown
 * - clientType is not mobile (web must not get mobile app role merges)
 */
export async function ensureAuthChannelCapability<T extends { roles?: unknown }>(
  uid: string,
  profile: T,
  authChannel?: AuthChannel,
  clientType?: 'web' | 'mobile'
): Promise<T> {
  if (clientType !== 'mobile' || !authChannel || !uid) {
    return profile;
  }

  const role = roleForAuthChannel(authChannel);
  if (rolesHaveCapability(profile.roles, role)) {
    return profile;
  }

  await Profile.updateOne(
    { uid },
    {
      $addToSet: { roles: role },
      $set: { updatedAt: Date.now() },
    }
  );

  const updated = (await Profile.findOne({ uid }).lean()) as T | null;

  logger.info('Ensured authChannel capability on profile', {
    uid,
    authChannel,
    clientType,
    role,
  });

  return updated ?? profile;
}
