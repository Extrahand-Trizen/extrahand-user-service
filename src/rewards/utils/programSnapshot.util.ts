import type { RewardProgramSnapshot } from '../types/RewardProgram';

/** New BOTH_KYC: referrer grant on enroll, referee on qualify. */
export function usesStaggeredBothKyc(snapshot: RewardProgramSnapshot | undefined): boolean {
  if (!snapshot?.referral) return false;
  if (snapshot.referral.qualificationMode !== 'BOTH_KYC') return false;
  return (snapshot.referral.grants.onEnroll || []).some((r) => r.recipient === 'referrer');
}
