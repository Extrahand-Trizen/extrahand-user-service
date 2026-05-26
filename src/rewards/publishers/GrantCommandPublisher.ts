import { PaymentServiceClient } from '../../clients/PaymentServiceClient';
import type { GrantSpec } from '../types/GrantSpec';
import logger from '../../config/logger';
import { rewardsFlags } from '../config/rewardsFlags';

/**
 * Executes grants via payment-service (HTTP v1; queue-swappable later).
 */
export class GrantCommandPublisher {
  static async issueGrants(grants: GrantSpec[]): Promise<void> {
    if (!grants.length) return;

    if (rewardsFlags.REWARDS_V2_ENABLED) {
      const result = await PaymentServiceClient.issueGrants(grants);
      if (!result.success) {
        logger.warn('[GrantCommandPublisher] issueGrants partial failure', { result });
      }
      return;
    }

    await this.legacyReferralAwards(grants);
  }

  private static async legacyReferralAwards(grants: GrantSpec[]): Promise<void> {
    const signupReferrer = grants.find((g) => g.metadata.source === 'referral_signup');
    const signupReferee = grants.find((g) => g.metadata.source === 'referral_welcome');
    if (signupReferrer && signupReferee) {
      await PaymentServiceClient.awardReferralCoins({
        type: 'signup',
        referrerUid: signupReferrer.recipientUid,
        refereeUid: signupReferee.recipientUid,
        referralCode: signupReferrer.metadata.referralCode || '',
      });
    }
  }
}
