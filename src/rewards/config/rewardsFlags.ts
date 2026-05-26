/**
 * Feature flags for marketplace incentives rollout.
 * Defaults: v2 on in non-production unless explicitly disabled.
 */
function envBool(key: string, defaultValue: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return defaultValue;
  return raw === 'true' || raw === '1';
}

const isProd = process.env.NODE_ENV === 'production';

export const rewardsFlags = {
  /** Use RewardProgram, QualificationEngine, issue-grants flow */
  REWARDS_V2_ENABLED: envBool('REWARDS_V2_ENABLED', true),
  /** Resolve referrer/referee to Firebase uid before payment */
  REWARDS_CANONICAL_UID: envBool('REWARDS_CANONICAL_UID', true),
  /** Process PAYMENT_COMPLETED / TASK_COMPLETED for non-AUTO modes */
  REWARDS_EXTENDED_QUALIFICATION: envBool('REWARDS_EXTENDED_QUALIFICATION', !isProd),
  /** Return 410 on legacy credit mutation endpoints */
  CREDITS_WRITES_DISABLED: envBool('CREDITS_WRITES_DISABLED', false),
};
