import type { GrantRule, GrantSpec } from '../types/GrantSpec';
import type { RewardProgramSnapshot } from '../types/RewardProgram';
import { RewardCampaign } from '../models/RewardCampaign';
import {
  referralQualifyGrantKey,
  referralSignupReferrerKey,
  referralSignupRefereeKey,
  referralTaskBonusKey,
} from './idempotencyKeys';

export interface ResolveGrantsContext {
  enrollmentId: string;
  referrerUid: string;
  refereeUid: string;
  referralCode: string;
  taskId?: string;
  platformFeeInr?: number;
}

function coinsFromRule(
  rule: GrantRule,
  coinValueInr: number,
  platformFeeInr?: number
): { coins: number; rupees: number } {
  const { type, value } = rule.amount;
  if (type === 'fixed_coins') {
    const coins = value;
    return { coins, rupees: coins * coinValueInr };
  }
  if (type === 'fixed_inr') {
    const rupees = value;
    return { coins: rupees / coinValueInr, rupees };
  }
  if (type === 'percent_of_platform_fee') {
    const fee = platformFeeInr ?? 0;
    const rupees = fee * value;
    return { coins: rupees / coinValueInr, rupees };
  }
  return { coins: 0, rupees: 0 };
}

function resolveRecipientUid(
  role: GrantRule['recipient'],
  ctx: ResolveGrantsContext
): string {
  if (role === 'referrer') return ctx.referrerUid;
  if (role === 'referee') return ctx.refereeUid;
  return ctx.refereeUid;
}

function idempotencyForRule(
  rule: GrantRule,
  trigger: 'on_enroll' | 'on_qualify',
  ctx: ResolveGrantsContext
): string {
  const recipientUid = resolveRecipientUid(rule.recipient, ctx);
  if (trigger === 'on_enroll') {
    if (rule.recipient === 'referrer') {
      return referralSignupReferrerKey(ctx.referrerUid, ctx.refereeUid);
    }
    return referralSignupRefereeKey(ctx.refereeUid, ctx.referrerUid);
  }
  if (rule.grantId.includes('task_bonus') && ctx.taskId) {
    return referralTaskBonusKey(ctx.referrerUid, ctx.taskId);
  }
  return referralQualifyGrantKey(ctx.enrollmentId, rule.grantId, recipientUid);
}

function metadataSource(rule: GrantRule, trigger: 'on_enroll' | 'on_qualify'): string {
  if (trigger === 'on_enroll') {
    return rule.recipient === 'referrer' ? 'referral_signup' : 'referral_welcome';
  }
  return 'referral_task_bonus';
}

/**
 * Pure grant resolution from frozen program snapshot.
 */
export class GrantResolver {
  /**
   * Optional campaign overlay (multiplier on coin amounts).
   */
  static async resolveCampaignMultiplier(programId: string): Promise<number> {
    const now = new Date();
    const campaign = await RewardCampaign.findOne({
      status: 'active',
      windowStart: { $lte: now },
      windowEnd: { $gte: now },
      appliesToProgramIds: programId,
    }).lean();
    if (!campaign?.grantMultiplier || campaign.grantMultiplier <= 0) {
      return 1;
    }
    return campaign.grantMultiplier;
  }

  static async resolve(
    snapshot: RewardProgramSnapshot,
    trigger: 'on_enroll' | 'on_qualify',
    ctx: ResolveGrantsContext
  ): Promise<GrantSpec[]> {
    const rules =
      trigger === 'on_enroll'
        ? snapshot.referral.grants.onEnroll || []
        : snapshot.referral.grants.onQualify || [];

    const multiplier = await this.resolveCampaignMultiplier(snapshot.programId);
    const coinValueInr = snapshot.coinEconomics.coinValueInr;
    const expiryMs = snapshot.coinEconomics.earnedExpiryDays * 24 * 60 * 60 * 1000;
    const expiresAt = new Date(Date.now() + expiryMs).toISOString();
    const specs: GrantSpec[] = [];

    for (const rule of rules) {
      const recipientUid = resolveRecipientUid(rule.recipient, ctx);
      let { coins, rupees } = coinsFromRule(rule, coinValueInr, ctx.platformFeeInr);
      if (multiplier !== 1) {
        coins *= multiplier;
        rupees *= multiplier;
      }
      if (coins <= 0) continue;

      const source = metadataSource(rule, trigger);
      specs.push({
        idempotencyKey: idempotencyForRule(rule, trigger, ctx),
        recipientUid,
        coins: coins.toFixed(2),
        rupeeValue: rupees.toFixed(2),
        expiresAt,
        taskId: ctx.taskId,
        metadata: {
          source,
          enrollmentId: ctx.enrollmentId,
          referralCode: ctx.referralCode,
          programVersion: snapshot.version,
          referrerUid: ctx.referrerUid,
          refereeUid: ctx.refereeUid,
          taskId: ctx.taskId,
        },
      });
    }

    return specs;
  }
}
