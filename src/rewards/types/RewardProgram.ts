import type { GrantRule } from './GrantSpec';

export type QualificationMode = 'AUTO' | 'FIRST_TASK' | 'FIRST_PAYMENT' | 'KYC';

export interface CoinEconomics {
  coinValueInr: number;
  earnedExpiryDays: number;
  expiringSoonDays: number;
  displayName?: string;
}

export interface ReferralProgramConfig {
  qualificationMode: QualificationMode;
  qualificationWindowDays: number;
  minQualifyingTaskAmountInr?: number;
  grants: {
    onEnroll: GrantRule[];
    onQualify?: GrantRule[];
  };
}

/** Configurable coin redemption caps per profile role (editable in Mongo). */
export interface CoinUsageRoleConfig {
  /** Poster checkout: max fraction of booking payable with coins (e.g. 0.1 = 10%). */
  redeemCapPercentOfBooking?: number;
  /** Tasker payout: max fraction of platform fee (ex-GST) payable with coins (e.g. 0.15 = 15%). */
  redeemCapPercentOfPlatformFee?: number;
}

export interface CoinUsageConfig {
  poster?: CoinUsageRoleConfig;
  tasker?: CoinUsageRoleConfig;
}

export interface RewardProgramDocument {
  programId: string;
  version: number;
  status: 'draft' | 'active' | 'archived';
  effectiveFrom?: Date;
  effectiveTo?: Date;
  coinEconomics: CoinEconomics;
  referral: ReferralProgramConfig;
  coinUsage?: CoinUsageConfig;
  taskRewards?: Record<string, unknown>;
}

export type RewardProgramSnapshot = RewardProgramDocument;
