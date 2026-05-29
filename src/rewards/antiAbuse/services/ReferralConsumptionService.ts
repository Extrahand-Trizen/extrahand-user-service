import type { GrantSpec } from '../../types/GrantSpec';
import { ReferralRewardConsumption } from '../models/ReferralRewardConsumption';
import type {
  ConsumptionCheckResult,
  ReferralConsumptionRewardType,
} from '../types/referralConsumption.types';
import { refereeWelcomeRewardType } from '../utils/rewardType.util';
import { logReferralCoins } from '../../referral/referralCoinsLogger';
import type { ReferralChannel } from '../../utils/walletRole';

export interface RecordConsumptionParams {
  phoneHash: string;
  rewardType: ReferralConsumptionRewardType;
  referrerId?: string;
  enrollmentId?: string;
}

export class ReferralConsumptionService {
  static async hasConsumed(
    phoneHash: string,
    rewardType: ReferralConsumptionRewardType
  ): Promise<boolean> {
    const row = await ReferralRewardConsumption.findOne({ phoneHash, rewardType })
      .select('_id')
      .lean();
    return Boolean(row);
  }

  static async checkRefereeWelcome(
    phoneHash: string,
    channel?: ReferralChannel
  ): Promise<ConsumptionCheckResult> {
    const rewardType = refereeWelcomeRewardType(channel);
    const consumed = await this.hasConsumed(phoneHash, rewardType);
    if (!consumed) {
      return { allowed: true, blocked: [] };
    }
    return {
      allowed: false,
      blocked: [{ rewardType, reason: 'already_consumed' }],
    };
  }

  /** Drop grants blocked by lifetime phone consumption (O(grants) DB lookups batched). */
  static async filterGrantsByConsumption(params: {
    grants: GrantSpec[];
    refereePhoneHash: string | null;
    referralChannel?: ReferralChannel;
    referrerId?: string;
  }): Promise<GrantSpec[]> {
    const { grants, refereePhoneHash, referralChannel, referrerId } = params;
    if (!grants.length) return grants;

    let refereeWelcomeBlocked = false;
    if (refereePhoneHash) {
      const check = await this.checkRefereeWelcome(refereePhoneHash, referralChannel);
      refereeWelcomeBlocked = !check.allowed;
    }

    const filtered: GrantSpec[] = [];
    for (const grant of grants) {
      const targetsReferee =
        Boolean(grant.metadata?.refereeUid) &&
        grant.recipientUid === grant.metadata?.refereeUid;

      if (refereeWelcomeBlocked && targetsReferee) {
        logReferralCoins(
          'consumption_grant_blocked',
          {
            phoneHashPrefix: refereePhoneHash?.slice(0, 8),
            recipientUid: grant.recipientUid,
            idempotencyKey: grant.idempotencyKey,
            rewardType: refereeWelcomeRewardType(referralChannel),
          },
          'warn'
        );
        continue;
      }

      filtered.push(grant);
    }

    if (refereeWelcomeBlocked && filtered.length < grants.length) {
      logReferralCoins('consumption_referee_welcome_skipped', {
        referrerId,
        phoneHashPrefix: refereePhoneHash?.slice(0, 8),
        blockedCount: grants.length - filtered.length,
      });
    }

    return filtered;
  }

  /** Insert ledger row after payment success (idempotent on duplicate key). */
  static async recordAfterSuccessfulGrant(params: RecordConsumptionParams): Promise<void> {
    try {
      await ReferralRewardConsumption.create({
        phoneHash: params.phoneHash,
        rewardType: params.rewardType,
        firstRewardedAt: new Date(),
        firstReferrerId: params.referrerId,
        firstEnrollmentId: params.enrollmentId,
      });
      logReferralCoins('consumption_recorded', {
        rewardType: params.rewardType,
        phoneHashPrefix: params.phoneHash.slice(0, 8),
        enrollmentId: params.enrollmentId,
      });
    } catch (err: unknown) {
      const code = (err as { code?: number })?.code;
      if (code === 11000) return;
      throw err;
    }
  }

  static async recordRefereeWelcomeIfNeeded(params: {
    grant: GrantSpec;
    refereePhoneHash: string;
    referralChannel?: ReferralChannel;
    referrerId?: string;
    enrollmentId?: string;
  }): Promise<void> {
    const { grant, refereePhoneHash, referralChannel, referrerId, enrollmentId } = params;
    if (grant.recipientUid !== grant.metadata?.refereeUid) return;
    const rewardType = refereeWelcomeRewardType(referralChannel);
    await this.recordAfterSuccessfulGrant({
      phoneHash: refereePhoneHash,
      rewardType,
      referrerId,
      enrollmentId,
    });
  }
}
