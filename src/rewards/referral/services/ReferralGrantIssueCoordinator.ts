import type { GrantSpec } from '../../types/GrantSpec';
import { GrantCommandPublisher, type GrantPublishResult } from '../../publishers/GrantCommandPublisher';
import { ReferralConsumptionService, grantTargetsReferrerReferralPayout } from '../../antiAbuse/services/ReferralConsumptionService';
import { refereeWelcomeRewardType } from '../../antiAbuse/utils/rewardType.util';
import type { ReferralChannel } from '../../utils/walletRole';
import { parseReferralChannel } from '../../utils/walletRole';
import { logReferralCoins } from '../referralCoinsLogger';

export interface IssueGrantsWithConsumptionParams {
  enrollmentId: string;
  grants: GrantSpec[];
  refereePhoneHash?: string | null;
  referralChannel?: ReferralChannel;
  referrerId?: string;
}

/**
 * Filters lifetime-consumed grants, issues via payment, records phone consumption for successful referral payouts.
 */
export class ReferralGrantIssueCoordinator {
  static async issue(params: IssueGrantsWithConsumptionParams): Promise<GrantPublishResult> {
    const filtered = await ReferralConsumptionService.filterGrantsByConsumption({
      grants: params.grants,
      refereePhoneHash: params.refereePhoneHash ?? null,
      referralChannel: params.referralChannel,
      referrerId: params.referrerId,
    });

    if (!filtered.length) {
      return {
        success: true,
        partial: false,
        results: [],
        grantsFailed: 0,
        grantsSucceeded: 0,
      };
    }

    const publishResult = await GrantCommandPublisher.issueGrants(filtered, {
      enrollmentId: params.enrollmentId,
    });

    if (params.refereePhoneHash) {
      await this.recordConsumptionForSuccessfulReferralGrants({
        results: publishResult.results,
        grants: filtered,
        refereePhoneHash: params.refereePhoneHash,
        referralChannel: params.referralChannel,
        referrerId: params.referrerId,
        enrollmentId: params.enrollmentId,
      });
    }

    return publishResult;
  }

  private static async recordConsumptionForSuccessfulReferralGrants(params: {
    results: Array<{ success?: boolean; idempotencyKey?: string }>;
    grants: GrantSpec[];
    refereePhoneHash: string;
    referralChannel?: ReferralChannel;
    referrerId?: string;
    enrollmentId: string;
  }): Promise<void> {
    const successKeys = new Set(
      (params.results || [])
        .filter((r) => r.success)
        .map((r) => r.idempotencyKey)
        .filter(Boolean) as string[]
    );

    const channel = parseReferralChannel(params.referralChannel);
    const rewardType = refereeWelcomeRewardType(params.referralChannel);

    for (const grant of params.grants) {
      if (!successKeys.has(grant.idempotencyKey)) continue;

      const isRefereeWelcome = grant.recipientUid === grant.metadata?.refereeUid;
      const isPosterReferrerPayout =
        channel === 'poster' && grantTargetsReferrerReferralPayout(grant);

      if (!isRefereeWelcome && !isPosterReferrerPayout) continue;

      await ReferralConsumptionService.recordAfterSuccessfulGrant({
        phoneHash: params.refereePhoneHash,
        rewardType,
        referrerId: params.referrerId,
        enrollmentId: params.enrollmentId,
      });
    }

    logReferralCoins('consumption_referral_record_batch_done', {
      enrollmentId: params.enrollmentId,
      successCount: successKeys.size,
    });
  }
}
