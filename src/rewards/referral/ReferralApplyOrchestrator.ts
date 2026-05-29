import { ReferralCode } from '../../models/ReferralCode';
import { ReferralRecord } from '../../models/ReferralRecord';
import { ReferralStatus } from '../../types/referral';
import { BadRequestError, NotFoundError } from '../../errors/AppError';
import { RewardConfigProvider } from '../config/RewardConfigProvider';
import { parseReferralChannel, type ReferralChannel } from '../utils/walletRole';
import type { ReferralGrantsStatus } from '../types/GrantsStatus';
import type { RewardProgramSnapshot } from '../types/RewardProgram';
import { RewardPipelineRunner } from './RewardPipelineRunner';
import { logReferralCoins } from './referralCoinsLogger';
import { ReferralEligibilityService } from './services/ReferralEligibilityService';
import Profile from '../../models/Profile';

export interface ApplyReferralResult {
  referralCode: string;
  status: ReferralStatus;
  expiresAt: Date;
  welcomeCoins: number;
  welcomeRupees: number;
  referrerCoins: number;
  enrollmentId: string;
  grantsStatus: ReferralGrantsStatus;
}

export class ReferralApplyOrchestrator {
  static async apply(params: {
    refereeUid: string;
    referralCode: string;
    refereeProfileId: string;
    codeChannel: ReferralChannel;
  }): Promise<ApplyReferralResult> {
    const code = params.referralCode.toUpperCase();

    logReferralCoins('orchestrator_apply_start', {
      refereeUid: params.refereeUid,
      refereeProfileId: params.refereeProfileId,
      referralCode: code,
      referralChannel: params.codeChannel,
    });

    const referrerCode = await ReferralCode.findOne({ code });
    if (!referrerCode) {
      logReferralCoins('orchestrator_apply_error', { referralCode: code, error: 'code_not_found' }, 'warn');
      throw new NotFoundError('Invalid referral code');
    }

    const referrerProfile = await Profile.findById(referrerCode.userId);
    if (!referrerProfile) {
      throw new NotFoundError('Referrer profile not found');
    }

    const referrerUid = referrerProfile.uid?.trim();
    if (!referrerUid) {
      logReferralCoins(
        'orchestrator_apply_error',
        {
          referralCode: code,
          referrerProfileId: String(referrerCode.userId),
          error: 'referrer_missing_firebase_uid',
        },
        'error'
      );
      throw new NotFoundError(
        'Referrer account is not fully set up. Ask them to log in once, then try again.'
      );
    }

    if (referrerCode.userId.toString() === params.refereeProfileId) {
      throw new BadRequestError('You cannot use your own referral code');
    }

    const referralChannel = parseReferralChannel(params.codeChannel);
    const { refereePhoneHash } = await ReferralEligibilityService.validateApply({
      refereeUid: params.refereeUid,
      refereeProfileId: params.refereeProfileId,
      referrerProfileId: referrerCode.userId.toString(),
      referralChannel,
    });

    logReferralCoins('orchestrator_referrer_resolved', {
      referralCode: code,
      referrerUid,
      referrerProfileId: String(referrerCode.userId),
      refereeUid: params.refereeUid,
      refereePhoneHashPrefix: refereePhoneHash.slice(0, 8),
    });

    const program = await RewardConfigProvider.getProgramByReferralChannel(referralChannel);
    const snapshot: RewardProgramSnapshot = RewardConfigProvider.snapshotFromProgram(program);
    const windowDays = snapshot.referral.qualificationWindowDays;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + windowDays * 24 * 60 * 60 * 1000);

    const refereeRule =
      (snapshot.referral.grants.onQualify || []).find((r) => r.recipient === 'referee') ||
      (snapshot.referral.grants.onEnroll || []).find((r) => r.recipient === 'referee');
    const referrerRule = (snapshot.referral.grants.onEnroll || []).find(
      (r) => r.recipient === 'referrer'
    );
    const coinValue = snapshot.coinEconomics.coinValueInr;
    const welcomeCoins =
      refereeRule?.amount.type === 'fixed_coins' ? refereeRule.amount.value : 100;
    const referrerCoins =
      referrerRule?.amount.type === 'fixed_coins' ? referrerRule.amount.value : 100;

    const record = await ReferralRecord.create({
      referrerId: referrerCode.userId,
      refereeId: params.refereeProfileId,
      referrerUid,
      refereeUid: params.refereeUid,
      refereePhoneHash,
      referralCode: code,
      referralChannel,
      referrerWalletRole: referralChannel,
      refereeWalletRole: referralChannel,
      status: ReferralStatus.PENDING,
      appliedAt: now,
      expiresAt,
      rewardProgramSnapshot: snapshot,
      referrerRewardAmount: referrerCoins,
      refereeRewardAmount: welcomeCoins,
      grantsStatus: 'pending',
    });

    const enrollmentId = record._id.toString();

    logReferralCoins('orchestrator_enrollment_created', {
      enrollmentId,
      referralCode: code,
      qualificationMode: snapshot.referral.qualificationMode,
      welcomeCoins,
      referrerCoins,
      refereeUid: params.refereeUid,
      referrerUid,
    });

    logReferralCoins('orchestrator_pipeline_start', { enrollmentId });
    const pipeline = await RewardPipelineRunner.runAfterEnroll({
      enrollmentId,
      referrerUid,
      refereeUid: params.refereeUid,
      referralCode: code,
    });

    const updated = await ReferralRecord.findById(enrollmentId).select('grantsStatus status').lean();
    const grantsStatus = (updated?.grantsStatus as ReferralGrantsStatus) || 'pending';

    logReferralCoins('orchestrator_pipeline_done', {
      enrollmentId,
      grantsStatus,
      referralRecordStatus: updated?.status,
      pipelineGrantsIssued: pipeline.grantsIssued,
      pipelineGrantsFailed: pipeline.grantsFailed,
      pipelineQualified: pipeline.qualified,
    });

    return {
      referralCode: code,
      status: ReferralStatus.PENDING,
      expiresAt,
      welcomeCoins,
      welcomeRupees: welcomeCoins * coinValue,
      referrerCoins,
      enrollmentId,
      grantsStatus,
    };
  }
}
