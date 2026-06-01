export function referralSignupReferrerKey(
  referrerUid: string,
  refereeUid: string,
  refereePhoneHash?: string
): string {
  const refereeKey = refereePhoneHash?.trim() || refereeUid;
  return `referral:signup:referrer:${referrerUid}:${refereeKey}`;
}

export function referralSignupRefereeKey(
  refereeUid: string,
  referrerUid: string,
  refereePhoneHash?: string
): string {
  const refereeKey = refereePhoneHash?.trim() || refereeUid;
  return `referral:signup:referee:${refereeKey}:${referrerUid}`;
}

export function referralTaskBonusKey(referrerUid: string, taskId: string): string {
  return `referral:task_bonus:${referrerUid}:${taskId}`;
}

export function referralQualifyGrantKey(
  enrollmentId: string,
  grantId: string,
  recipientUid: string,
  refereePhoneHash?: string
): string {
  const suffix = refereePhoneHash?.trim() || recipientUid;
  return `referral:qualify:${enrollmentId}:${grantId}:${suffix}`;
}
