import type { RewardProgramDocument } from '../types/RewardProgram';

const BASE_COIN_ECONOMICS = {
  coinValueInr: 1.0,
  earnedExpiryDays: 180,
  expiringSoonDays: 7,
  displayName: 'ExtraCoins',
};

const BASE_COIN_USAGE = {
  poster: { redeemCapPercentOfBooking: 0.1 },
  tasker: { redeemCapPercentOfPlatformFee: 0.15 },
};

/** Poster referral: referee instant, referrer after first paid booking */
export function getDefaultPosterRewardProgramV1(): RewardProgramDocument {
  return {
    programId: 'referral_poster_v1',
    version: 1,
    status: 'active',
    coinEconomics: BASE_COIN_ECONOMICS,
    coinUsage: BASE_COIN_USAGE,
    referral: {
      qualificationMode: 'FIRST_PAYMENT',
      qualificationWindowDays: 30,
      minQualifyingTaskAmountInr: 0,
      grants: {
        onEnroll: [
          {
            grantId: 'referee_welcome',
            recipient: 'referee',
            trigger: 'on_enroll',
            amount: { type: 'fixed_coins', value: 100 },
          },
        ],
        onQualify: [
          {
            grantId: 'referrer_first_paid_booking',
            recipient: 'referrer',
            trigger: 'on_qualify',
            amount: { type: 'fixed_coins', value: 100 },
          },
        ],
      },
    },
  };
}

/** Tasker referral: referrer on enroll (if KYC), referee on qualify (Aadhaar); BOTH_KYC gate on qualify */
export function getDefaultTaskerRewardProgramV1(): RewardProgramDocument {
  return {
    programId: 'referral_tasker_v1',
    version: 1,
    status: 'active',
    coinEconomics: BASE_COIN_ECONOMICS,
    coinUsage: BASE_COIN_USAGE,
    referral: {
      qualificationMode: 'BOTH_KYC',
      qualificationWindowDays: 30,
      minQualifyingTaskAmountInr: 0,
      grants: {
        onEnroll: [
          {
            grantId: 'tasker_referrer_signup',
            recipient: 'referrer',
            trigger: 'on_enroll',
            amount: { type: 'fixed_coins', value: 100 },
          },
        ],
        onQualify: [
          {
            grantId: 'tasker_referee_welcome',
            recipient: 'referee',
            trigger: 'on_qualify',
            amount: { type: 'fixed_coins', value: 100 },
          },
        ],
      },
    },
  };
}

/** @deprecated Use getDefaultPosterRewardProgramV1 — legacy program id referral_customer_v1 */
export function getDefaultCustomerRewardProgramV1(): RewardProgramDocument {
  const doc = getDefaultPosterRewardProgramV1();
  return { ...doc, programId: 'referral_customer_v1' };
}

/** Backward compatibility default */
export function getDefaultRewardProgramV1(): RewardProgramDocument {
  return getDefaultTaskerRewardProgramV1();
}
