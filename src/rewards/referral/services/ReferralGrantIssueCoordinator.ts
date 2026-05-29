import type { GrantSpec } from '../../types/GrantSpec';
import { GrantCommandPublisher, type GrantPublishResult } from '../../publishers/GrantCommandPublisher';
import { ReferralConsumptionService } from '../../antiAbuse/services/ReferralConsumptionService';
import { refereeWelcomeRewardType } from '../../antiAbuse/utils/rewardType.util';
import type { ReferralChannel } from '../../utils/walletRole';
import { logReferralCoins } from '../referralCoinsLogger';

export interface IssueGrantsWithConsumptionParams {
  enrollmentId: string;
  grants: GrantSpec[];
  refereePhoneHash?: string | null;
  referralChannel?: ReferralChannel;
  referrerId?: string;
}

/**
 * Filters lifetime-consumed grants, issues via payment, records consumption for successful referee welcomes.
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
      await this.recordConsumptionForSuccessfulRefereeGrants({
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

  private static async recordConsumptionForSuccessfulRefereeGrants(params: {
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

    for (const grant of params.grants) {
      if (!successKeys.has(grant.idempotencyKey)) continue;
      if (grant.recipientUid !== grant.metadata?.refereeUid) continue;

      await ReferralConsumptionService.recordAfterSuccessfulGrant({
        phoneHash: params.refereePhoneHash,
        rewardType: refereeWelcomeRewardType(params.referralChannel),
        referrerId: params.referrerId,
        enrollmentId: params.enrollmentId,
      });
    }

    logReferralCoins('consumption_referee_record_batch_done', {
      enrollmentId: params.enrollmentId,
      successCount: successKeys.size,
    });
  }
}
