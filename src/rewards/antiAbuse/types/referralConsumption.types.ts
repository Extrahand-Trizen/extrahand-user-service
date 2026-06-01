/** Lifetime consumption types — extend when new one-time referral entitlements are added. */
export type ReferralConsumptionRewardType =
  | 'referee_tasker_welcome'
  | 'referee_poster_welcome'
  | 'referee_customer_welcome';

export interface ReferralConsumptionRecord {
  phoneHash: string;
  rewardType: ReferralConsumptionRewardType;
  firstRewardedAt: Date;
  firstReferrerId?: string;
  firstEnrollmentId?: string;
}

export interface ConsumptionBlockReason {
  rewardType: ReferralConsumptionRewardType;
  reason: 'already_consumed';
}

export interface ConsumptionCheckResult {
  allowed: boolean;
  blocked: ConsumptionBlockReason[];
}
