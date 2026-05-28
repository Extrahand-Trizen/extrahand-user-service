import logger from '../../config/logger';

/**
 * Marketplace incentives flags (Phase 1: v2 locked, legacy credit writes off by default).
 */
function envBool(key: string, defaultValue: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return defaultValue;
  return raw === 'true' || raw === '1';
}

function isExplicitlyFalse(key: string): boolean {
  const raw = process.env[key];
  return raw === 'false' || raw === '0';
}

/** v2 (RewardProgram + issue-grants) is mandatory after Phase 1 */
export const REWARDS_V2_REQUIRED = true;

export const rewardsFlags = {
  /** RewardProgram → QualificationEngine → issue-grants (always on; env false rejected at startup) */
  REWARDS_V2_ENABLED: true as const,
  /** Resolve referrer/referee to Firebase uid before payment */
  REWARDS_CANONICAL_UID: envBool('REWARDS_CANONICAL_UID', true),
  /** Process PAYMENT_COMPLETED / TASK_COMPLETED for non-AUTO qualification modes */
  REWARDS_EXTENDED_QUALIFICATION: envBool('REWARDS_EXTENDED_QUALIFICATION', true),
  /** Block legacy Mongo credit mutations (use ExtraCoins) */
  CREDITS_WRITES_DISABLED: envBool('CREDITS_WRITES_DISABLED', true),
  /** Poster + tasker referral codes per user */
  DUAL_REFERRAL_CODE_ENABLED: envBool('DUAL_REFERRAL_CODE_ENABLED', true),
  /** Role-isolated ExtraCoin wallets in payment-service */
  DUAL_WALLET_ENABLED: envBool('DUAL_WALLET_ENABLED', true),
};

/**
 * Fail fast if deployment tries to disable v2 or re-enable legacy credits without intent.
 */
export function validateRewardsConfiguration(): void {
  if (isExplicitlyFalse('REWARDS_V2_ENABLED')) {
    throw new Error(
      'REWARDS_V2_ENABLED=false is not supported. ExtraHand requires RewardProgram + issue-grants (rewards Phase 1).'
    );
  }

  if (!rewardsFlags.CREDITS_WRITES_DISABLED) {
    logger.warn(
      '[rewards] CREDITS_WRITES_DISABLED=false — legacy Mongo /credits/* mutations are enabled (not recommended).'
    );
  }

  if (!rewardsFlags.REWARDS_EXTENDED_QUALIFICATION) {
    logger.warn(
      '[rewards] REWARDS_EXTENDED_QUALIFICATION=false — PAYMENT_COMPLETED / TASK_COMPLETED qualification is disabled.'
    );
  }

  logger.info('[rewards] Configuration locked (Phase 1)', {
    rewardsV2: true,
    creditsWritesDisabled: rewardsFlags.CREDITS_WRITES_DISABLED,
    extendedQualification: rewardsFlags.REWARDS_EXTENDED_QUALIFICATION,
    canonicalUid: rewardsFlags.REWARDS_CANONICAL_UID,
    dualReferralCode: rewardsFlags.DUAL_REFERRAL_CODE_ENABLED,
    dualWallet: rewardsFlags.DUAL_WALLET_ENABLED,
  });
}
