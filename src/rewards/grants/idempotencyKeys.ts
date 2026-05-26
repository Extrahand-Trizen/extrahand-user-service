export function referralSignupReferrerKey(referrerUid: string, refereeUid: string): string {
  return `referral:signup:referrer:${referrerUid}:${refereeUid}`;
}

export function referralSignupRefereeKey(refereeUid: string, referrerUid: string): string {
  return `referral:signup:referee:${refereeUid}:${referrerUid}`;
}

export function referralTaskBonusKey(referrerUid: string, taskId: string): string {
  return `referral:task_bonus:${referrerUid}:${taskId}`;
}

export function referralQualifyGrantKey(
  enrollmentId: string,
  grantId: string,
  recipientUid: string
): string {
  return `referral:qualify:${enrollmentId}:${grantId}:${recipientUid}`;
}
