const INDIAN_PIN_RE = /^\d{6}$/;

export function extractCityFromAddress(addr: string): string {
  const parts = String(addr || '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return '';

  const nonPlusCode = parts.filter((p) => !p.includes('+'));
  const tokens = nonPlusCode.length > 0 ? nonPlusCode : parts;

  if (tokens.length >= 3) {
    return tokens[tokens.length - 3] || '';
  }
  if (tokens.length >= 2) {
    const candidate = tokens[tokens.length - 2] || '';
    if (INDIAN_PIN_RE.test(candidate)) {
      return tokens[tokens.length - 3] || tokens[0] || '';
    }
    return candidate || tokens[0] || '';
  }
  return tokens[0] || '';
}

export function isIndianPinCode(value: string | null | undefined): boolean {
  return INDIAN_PIN_RE.test(String(value || '').trim());
}

export type ProfileLocationLike = {
  address?: string | null;
  city?: string | null;
  pinCode?: string | null;
  addressDetails?: {
    city?: string | null;
    area?: string | null;
    pinCode?: string | null;
    state?: string | null;
    doorNo?: string | null;
  } | null;
} | null | undefined;

export function normalizeProfileLocationParts(
  location?: ProfileLocationLike,
): { city: string; pinCode: string } {
  let city =
    String(location?.addressDetails?.city || '').trim() ||
    String(location?.city || '').trim();
  let pinCode =
    String(location?.addressDetails?.pinCode || '').trim() ||
    String((location as { pinCode?: string })?.pinCode || '').trim();

  if (city && isIndianPinCode(city)) {
    if (!pinCode) pinCode = city;
    city = '';
  }

  if (pinCode && !isIndianPinCode(pinCode) && !city) {
    city = pinCode;
    pinCode = '';
  }

  const address = String(location?.address || '').trim();
  if (!city) {
    const doorNo = String(location?.addressDetails?.doorNo || '').trim();
    city =
      extractCityFromAddress(address) ||
      (doorNo && !isIndianPinCode(doorNo) ? doorNo : '') ||
      String(location?.addressDetails?.area || '').trim();
  }

  if (city && isIndianPinCode(city)) {
    if (!pinCode) pinCode = city;
    city = extractCityFromAddress(address) || '';
  }

  return { city: city.trim(), pinCode: pinCode.trim() };
}

export function normalizeCityKey(city: string): string {
  return String(city || '').trim().toLowerCase();
}

export function citiesMatch(customerCity: string, helperCity: string): boolean {
  const a = normalizeCityKey(customerCity);
  const b = normalizeCityKey(helperCity);
  if (!a || !b) return false;
  return a === b;
}

export function resolveProfileCityForMatching(location?: ProfileLocationLike): string | null {
  const { city } = normalizeProfileLocationParts(location);
  return city || null;
}

/** Selected/detected location wins over saved profile (poster helper availability). */
export function resolvePosterCityForHelperCheck(params: {
  effective?: ProfileLocationLike;
  profile?: ProfileLocationLike;
}): string | null {
  const fromEffective = normalizeProfileLocationParts(params.effective).city;
  if (fromEffective) return fromEffective;
  return resolveProfileCityForMatching(params.profile);
}
