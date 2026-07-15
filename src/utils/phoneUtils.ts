import Profile from '../models/Profile';

export type PhoneMatchType = 'primary' | 'alternate';

export function normalizePhoneToE164(phone: string): string {
  const cleanPhone = String(phone || '').replace(/\D/g, '');
  if (!cleanPhone) return '';
  return cleanPhone.startsWith('91') ? `+${cleanPhone}` : `+91${cleanPhone}`;
}

export function getTenDigitPhone(phone: string): string {
  const cleanPhone = String(phone || '').replace(/\D/g, '');
  return cleanPhone.length >= 10 ? cleanPhone.slice(-10) : cleanPhone;
}

export function buildPhoneSearchFormats(phone: string): string[] {
  const cleanPhone = String(phone || '').replace(/\D/g, '');
  const tenDigitNumber = getTenDigitPhone(cleanPhone);
  const formattedPhone = normalizePhoneToE164(phone);

  const searchFormats = [
    formattedPhone,
    formattedPhone.replace('+91', '+91-'),
    `+91 ${tenDigitNumber}`,
    `91 ${tenDigitNumber}`,
    cleanPhone,
    `+${cleanPhone}`,
    cleanPhone.startsWith('91') ? cleanPhone : `91${cleanPhone}`,
    tenDigitNumber,
    `+91${tenDigitNumber}`,
    `91${tenDigitNumber}`,
  ];

  return [...new Set(searchFormats.filter(Boolean))];
}

function activeProfileFilter() {
  return {
    'dataPrivacy.accountDeleted': { $ne: true },
    isActive: { $ne: false },
  };
}

function buildFieldOrQuery(field: 'phone' | 'alternatePhone', formats: string[]) {
  return formats.map((format) => ({ [field]: format }));
}

export async function findProfileByPrimaryPhone(phone: string) {
  const formats = buildPhoneSearchFormats(phone);
  const tenDigitNumber = getTenDigitPhone(phone);

  let profile = await Profile.findOne({
    ...activeProfileFilter(),
    $or: buildFieldOrQuery('phone', formats),
  }).lean();

  if (!profile && tenDigitNumber.length === 10) {
    profile = await Profile.findOne({
      ...activeProfileFilter(),
      $or: [
        { phone: { $regex: new RegExp(`${tenDigitNumber}$`) } },
        { phone: { $regex: new RegExp(`^\\+?91?\\s*${tenDigitNumber}`) } },
      ],
    }).lean();
  }

  return profile;
}

export async function findProfileByVerifiedAlternatePhone(phone: string) {
  const formats = buildPhoneSearchFormats(phone);
  const tenDigitNumber = getTenDigitPhone(phone);

  let profile = await Profile.findOne({
    ...activeProfileFilter(),
    alternatePhoneVerified: true,
    $or: buildFieldOrQuery('alternatePhone', formats),
  }).lean();

  if (!profile && tenDigitNumber.length === 10) {
    profile = await Profile.findOne({
      ...activeProfileFilter(),
      alternatePhoneVerified: true,
      $or: [
        { alternatePhone: { $regex: new RegExp(`${tenDigitNumber}$`) } },
        { alternatePhone: { $regex: new RegExp(`^\\+?91?\\s*${tenDigitNumber}`) } },
      ],
    }).lean();
  }

  return profile;
}

export async function findProfileByAnyRegisteredPhone(phone: string): Promise<{
  profile: any | null;
  matchType: PhoneMatchType | null;
}> {
  const primary = await findProfileByPrimaryPhone(phone);
  if (primary) {
    return { profile: primary, matchType: 'primary' };
  }

  const alternate = await findProfileByVerifiedAlternatePhone(phone);
  if (alternate) {
    return { profile: alternate, matchType: 'alternate' };
  }

  return { profile: null, matchType: null };
}

export async function isPhoneUsedGlobally(
  phone: string,
  excludeUid?: string
): Promise<{ used: boolean; matchType?: PhoneMatchType; ownerUid?: string }> {
  const normalized = normalizePhoneToE164(phone);
  const formats = buildPhoneSearchFormats(phone);
  const uidFilter = excludeUid ? { uid: { $ne: excludeUid } } : {};

  const primaryConflict = await Profile.findOne({
    ...activeProfileFilter(),
    ...uidFilter,
    $or: buildFieldOrQuery('phone', formats),
  })
    .select('uid phone')
    .lean();

  if (primaryConflict) {
    return { used: true, matchType: 'primary', ownerUid: primaryConflict.uid };
  }

  const alternateConflict = await Profile.findOne({
    ...activeProfileFilter(),
    ...uidFilter,
    alternatePhoneVerified: true,
    $or: buildFieldOrQuery('alternatePhone', formats),
  })
    .select('uid alternatePhone')
    .lean();

  if (alternateConflict) {
    return { used: true, matchType: 'alternate', ownerUid: alternateConflict.uid };
  }

  // Pending alternate OTP for another account counts as reserved
  const PhoneOTP = (await import('../models/PhoneOTP')).default;
  const pendingAlternate = await PhoneOTP.findOne({
    purpose: 'alternate_add',
    verified: false,
    expiresAt: { $gt: new Date() },
    ...(excludeUid ? { uid: { $ne: excludeUid } } : {}),
    phone: normalized,
  })
    .select('uid phone')
    .lean();

  if (pendingAlternate) {
    return { used: true, matchType: 'alternate', ownerUid: pendingAlternate.uid };
  }

  return { used: false };
}

export function profileHasVerifiedAlternate(profile: any, phone: string): boolean {
  if (!profile?.alternatePhoneVerified || !profile?.alternatePhone) return false;
  const provided = getTenDigitPhone(phone);
  const stored = getTenDigitPhone(profile.alternatePhone);
  return provided.length === 10 && provided === stored;
}
