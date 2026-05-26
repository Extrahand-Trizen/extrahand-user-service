import type { RewardProgramDocument } from '../types/RewardProgram';

/** Default v1: AUTO qualify, 100 coins referrer + 100 coins referee */
export function getDefaultRewardProgramV1(): RewardProgramDocument {
  return {
    programId: 'referral_v1',
    version: 1,
    status: 'active',
    coinEconomics: {
      coinValueInr: 0.2,
      earnedExpiryDays: 180,
      expiringSoonDays: 7,
      displayName: 'ExtraCoins',
    },
    referral: {
      qualificationMode: 'AUTO',
      qualificationWindowDays: 30,
      minQualifyingTaskAmountInr: 500,
      grants: {
        onEnroll: [
          {
            grantId: 'referrer_signup',
            recipient: 'referrer',
            trigger: 'on_enroll',
            amount: { type: 'fixed_coins', value: 100 },
          },
          {
            grantId: 'referee_welcome',
            recipient: 'referee',
            trigger: 'on_enroll',
            amount: { type: 'fixed_coins', value: 100 },
          },
        ],
        onQualify: [],
      },
    },
  };
}
