import Profile from '../models/Profile';
import logger from '../config/logger';

/**
 * Product surface that completed auth. Orthogonal to clientType (web|mobile).
 * Used to ensure the matching capability without stripping the other role.
 * Callers must only pass authChannel when clientType === 'mobile'.
 */
export type AuthChannel = 'customer_app' | 'helper_app' | 'partner_app' | 'seller_app';

export function parseAuthChannel(raw: unknown): AuthChannel | undefined {
  if (raw == null) return undefined;
  const value = String(raw).trim().toLowerCase().replace(/-/g, '_');
  if (value === 'customer_app' || value === 'customerapp') return 'customer_app';
  if (value === 'helper_app' || value === 'helperapp') return 'helper_app';
  if (value === 'partner_app' || value === 'partnerapp') return 'partner_app';
  if (value === 'seller_app' || value === 'sellerapp') return 'seller_app';
  return undefined;
}

export function roleForAuthChannel(channel: AuthChannel): 'poster' | 'tasker' | 'partner' | 'seller' {
  if (channel === 'helper_app') return 'tasker';
  if (channel === 'partner_app') return 'partner';
  if (channel === 'seller_app') return 'seller';
  return 'poster';
}

function rolesForPartnerApp(rolesRaw: unknown): Array<'poster' | 'partner' | 'seller'> {
  const roles = Array.isArray(rolesRaw)
    ? rolesRaw.map((role) => String(role || '').trim().toLowerCase())
    : [];
  const hasPoster =
    roles.includes('poster') ||
    roles.includes('requester') ||
    roles.includes('customer') ||
    roles.includes('both');
  const hasSeller = roles.includes('seller');

  return [
    ...(hasPoster ? ['poster' as const] : []),
    'partner',
    ...(hasSeller ? ['seller' as const] : []),
  ];
}

/** Dialog / Meta welcome mapping for each mobile app binary. */
export function welcomeWhatsAppForAuthChannel(channel: AuthChannel): {
  eventKey: 'CUSTOMER_WELCOME' | 'HELPER_WELCOME';
  metaTemplateName: 'extrahand_customer_welcome' | 'extrahand_helper_welcome';
  legacyTemplateKey: 'wa_customer_welcome' | 'wa_helper_welcome';
  role: 'poster' | 'helper' | 'partner' | 'seller';
  idempotencyKey: (uid: string) => string;
} {
  if (channel === 'helper_app' || channel === 'partner_app') {
    return {
      eventKey: 'HELPER_WELCOME',
      metaTemplateName: 'extrahand_helper_welcome',
      legacyTemplateKey: 'wa_helper_welcome',
      role: channel === 'partner_app' ? 'partner' : 'helper',
      idempotencyKey: (uid) => `welcome:${channel === 'partner_app' ? 'partner' : 'helper'}:${uid}`,
    };
  }
  if (channel === 'seller_app') {
    return {
      eventKey: 'CUSTOMER_WELCOME',
      metaTemplateName: 'extrahand_customer_welcome',
      legacyTemplateKey: 'wa_customer_welcome',
      role: 'seller',
      idempotencyKey: (uid) => `welcome:seller:${uid}`,
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
  capability: 'poster' | 'tasker' | 'partner' | 'seller'
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

  if (capability === 'seller') {
    return roles.includes('seller');
  }

  if (capability === 'partner') {
    return roles.includes('partner');
  }

  if (capability === 'tasker') {
    return (
      roles.includes('tasker') ||
      roles.includes('helper') ||
      roles.includes('performer')
    );
  }

  return false;
}

/**
 * Ensure the profile has the capability for this auth channel.
 * Partner registration replaces helper capability but preserves customer/seller roles.
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

  if (authChannel === 'partner_app') {
    const roles = rolesForPartnerApp(profile.roles);
    const existingRoles = Array.isArray(profile.roles)
      ? profile.roles.map((role) => String(role || '').trim().toLowerCase())
      : [];
    if (
      existingRoles.length === roles.length &&
      roles.every((role, index) => role === existingRoles[index])
    ) {
      return profile;
    }

    await Profile.updateOne(
      { uid },
      {
        $set: { roles, updatedAt: Date.now() },
      }
    );

    const updated = (await Profile.findOne({ uid }).lean()) as T | null;
    logger.info('Ensured partner capability on profile', {
      uid,
      authChannel,
      clientType,
      roles,
    });
    return updated ?? profile;
  }

  const role = roleForAuthChannel(authChannel);
  if (authChannel === 'helper_app' && rolesHaveCapability(profile.roles, 'partner')) {
    return profile;
  }
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
