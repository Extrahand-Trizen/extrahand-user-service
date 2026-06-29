/** Indian state / UT codes used on driving licences (incl. legacy codes). */
export const INDIAN_DL_STATE_CODES = new Set([
  'AN', 'AP', 'AR', 'AS', 'BR', 'CG', 'CH', 'DD', 'DL', 'GA', 'GJ', 'HP', 'HR',
  'JH', 'JK', 'KA', 'KL', 'LA', 'LD', 'MH', 'ML', 'MN', 'MP', 'MZ', 'NL', 'OD',
  'OR',
  'PB', 'PY', 'RJ', 'SK', 'TN', 'TR', 'TS', 'UK', 'UP', 'WB',
]);

export type DrivingLicenseValidationResult = {
  isValid: boolean;
  cleanValue: string;
  error?: string;
  stateCode?: string;
  rtoCode?: string;
  issueYear?: number;
  serialNumber?: string;
};

const DL_CLEAN_REGEX = /^[A-Z]{2}[0-9]{13,14}$/;
const MIN_ISSUE_YEAR = 1950;

export function validateDrivingLicense(raw: string): DrivingLicenseValidationResult {
  const trimmed = raw.trim();
  const cleanValue = trimmed.toUpperCase().replace(/[\s-]/g, '');

  if (!cleanValue) {
    return { isValid: false, cleanValue, error: 'Driving license number is required' };
  }

  if (!DL_CLEAN_REGEX.test(cleanValue)) {
    return {
      isValid: false,
      cleanValue,
      error: 'Enter a valid driving license number (e.g. TS0920200001234)',
    };
  }

  const stateCode = cleanValue.slice(0, 2);
  if (!INDIAN_DL_STATE_CODES.has(stateCode)) {
    return { isValid: false, cleanValue, error: 'Invalid state code on driving license' };
  }

  const is16Char = cleanValue.length === 16;
  const rtoLen = is16Char ? 3 : 2;
  const rtoCode = cleanValue.slice(2, 2 + rtoLen);
  const issueYearStr = cleanValue.slice(2 + rtoLen, 6 + rtoLen);
  const serialNumber = cleanValue.slice(6 + rtoLen);

  const issueYear = Number(issueYearStr);
  const currentYear = new Date().getFullYear();

  if (!Number.isFinite(issueYear) || issueYear < MIN_ISSUE_YEAR || issueYear > currentYear) {
    return {
      isValid: false,
      cleanValue,
      error: `Issue year must be between ${MIN_ISSUE_YEAR} and ${currentYear}`,
    };
  }

  if (/^0+$/.test(serialNumber)) {
    return { isValid: false, cleanValue, error: 'Invalid serial number on driving license' };
  }

  return {
    isValid: true,
    cleanValue,
    stateCode,
    rtoCode,
    issueYear,
    serialNumber,
  };
}

/**
 * Normalize partnerProfile.dlNumber when present. Returns error message if invalid.
 */
export function normalizePartnerProfileDlNumber(
  partnerProfile: Record<string, unknown> | undefined,
): string | null {
  if (!partnerProfile || partnerProfile.dlNumber == null) {
    return null;
  }

  const raw = String(partnerProfile.dlNumber).trim();
  if (!raw) {
    delete partnerProfile.dlNumber;
    return null;
  }

  const result = validateDrivingLicense(raw);
  if (!result.isValid) {
    return result.error ?? 'Invalid driving license number';
  }

  partnerProfile.dlNumber = result.cleanValue;
  return null;
}
