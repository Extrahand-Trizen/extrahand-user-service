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

export interface RewardProgramDocument {
  programId: string;
  version: number;
  status: 'draft' | 'active' | 'archived';
  effectiveFrom?: Date;
  effectiveTo?: Date;
  coinEconomics: CoinEconomics;
  referral: ReferralProgramConfig;
  taskRewards?: Record<string, unknown>;
}

export type RewardProgramSnapshot = RewardProgramDocument;
