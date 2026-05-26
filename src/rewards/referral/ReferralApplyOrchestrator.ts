import Profile from '../../models/Profile';
import { ReferralCode } from '../../models/ReferralCode';
import { ReferralRecord } from '../../models/ReferralRecord';
import { ReferralStatus } from '../../types/referral';
import { RewardConfigProvider } from '../config/RewardConfigProvider';
import { rewardsFlags } from '../config/rewardsFlags';
import { inProcessEventBus, createPlatformEvent } from '../events/InProcessEventBus';
import type { ReferralEnrolledPayload } from '../types/PlatformEvent';
import type { RewardProgramSnapshot } from '../types/RewardProgram';

export interface ApplyReferralResult {
  referralCode: string;
  status: ReferralStatus;
  expiresAt: Date;
  welcomeCoins: number;
  welcomeRupees: number;
  referrerCoins: number;
  enrollmentId: string;
}

export class ReferralApplyOrchestrator {
  static async apply(params: {
    refereeUid: string;
    referralCode: string;
    refereeProfileId: string;
  }): Promise<ApplyReferralResult> {
    const code = params.referralCode.toUpperCase();
    const referrerCode = await ReferralCode.findOne({ code });
    if (!referrerCode) {
      throw Object.assign(new Error('Invalid referral code'), { statusCode: 404 });
    }

    const referrerProfile = await Profile.findById(referrerCode.userId);
    if (!referrerProfile?.uid) {
      throw Object.assign(new Error('Referrer profile not found'), { statusCode: 404 });
    }

    const referrerUid = referrerProfile.uid;

    if (referrerCode.userId.toString() === params.refereeProfileId) {
      throw Object.assign(new Error('You cannot use your own referral code'), { statusCode: 400 });
    }

    const program = await RewardConfigProvider.getActiveProgram();
    const snapshot: RewardProgramSnapshot = RewardConfigProvider.snapshotFromProgram(program);
    const windowDays = snapshot.referral.qualificationWindowDays;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + windowDays * 24 * 60 * 60 * 1000);

    const refereeRule = snapshot.referral.grants.onEnroll.find((r) => r.recipient === 'referee');
    const referrerRule = snapshot.referral.grants.onEnroll.find((r) => r.recipient === 'referrer');
    const coinValue = snapshot.coinEconomics.coinValueInr;
    const welcomeCoins = refereeRule?.amount.type === 'fixed_coins' ? refereeRule.amount.value : 100;
    const referrerCoins = referrerRule?.amount.type === 'fixed_coins' ? referrerRule.amount.value : 100;

    const record = await ReferralRecord.create({
      referrerId: referrerCode.userId,
      refereeId: params.refereeProfileId,
      referrerUid,
      refereeUid: params.refereeUid,
      referralCode: code,
      status: ReferralStatus.PENDING,
      appliedAt: now,
      expiresAt,
      rewardProgramSnapshot: snapshot,
      referrerRewardAmount: referrerCoins,
      refereeRewardAmount: welcomeCoins,
    });

    if (rewardsFlags.REWARDS_V2_ENABLED) {
      const event = createPlatformEvent<ReferralEnrolledPayload>(
        'REFERRAL_ENROLLED',
        {
          enrollmentId: record._id.toString(),
          referrerUid,
          refereeUid: params.refereeUid,
          referralCode: code,
        },
        record._id.toString()
      );
      await inProcessEventBus.publish(event);
    } else if (rewardsFlags.REWARDS_CANONICAL_UID) {
      const { PaymentServiceClient } = await import('../../clients/PaymentServiceClient');
      PaymentServiceClient.awardReferralCoins({
        type: 'signup',
        referrerUid,
        refereeUid: params.refereeUid,
        referralCode: code,
      }).catch(() => undefined);
    } else {
      const { PaymentServiceClient } = await import('../../clients/PaymentServiceClient');
      PaymentServiceClient.awardReferralCoins({
        type: 'signup',
        referrerUid: referrerCode.userId.toString(),
        refereeUid: params.refereeUid,
        referralCode: code,
      }).catch(() => undefined);
    }

    const refreshed = await ReferralRecord.findById(record._id);
    const status = (refreshed?.status || record.status) as ReferralStatus;

    return {
      referralCode: code,
      status,
      expiresAt,
      welcomeCoins,
      welcomeRupees: welcomeCoins * coinValue,
      referrerCoins,
      enrollmentId: record._id.toString(),
    };
  }
}
