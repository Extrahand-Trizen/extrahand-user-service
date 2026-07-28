import { ReferralRecord } from '../../models/ReferralRecord';
import { ReferralStatus } from '../../types/referral';
import { NotFoundError, BadRequestError } from '../../errors/AppError';
import type { RewardProgramSnapshot } from '../types/RewardProgram';
import type { ReferralGrantsStatus } from '../types/GrantsStatus';
import { GrantResolver, type ResolveGrantsContext } from '../grants/GrantResolver';
import { QualificationEngine } from '../qualification/QualificationEngine';
import { createPlatformEvent } from '../events/InProcessEventBus';
import { usesStaggeredBothKyc } from '../utils/programSnapshot.util';
import { ReferralGrantIssueCoordinator } from './services/ReferralGrantIssueCoordinator';
import {
  grantsStatusFromSummary,
  summarizeGrantResults,
} from './grantEnrollmentTracker';
import logger from '../../config/logger';
import { logReferralCoins, summarizeGrantsForLog } from './referralCoinsLogger';
import { parseReferralChannel } from '../utils/walletRole';

export interface ReissueGrantsResult {
  grantsStatus: ReferralGrantsStatus;
  grantsIssued: number;
  grantsFailed: number;
  qualified: boolean;
}

/**
 * Re-issues enroll (and AUTO qualify) grants for an enrollment with failed/pending grants.
 * Safe to call when payment issue-grants failed on first attempt.
 */
export class ReferralGrantReissue {
  static async reissue(enrollmentId: string): Promise<ReissueGrantsResult> {
    const enrollment = await ReferralRecord.findById(enrollmentId);
    if (!enrollment) {
      throw new NotFoundError('Referral enrollment not found');
    }

    const snapshot = enrollment.rewardProgramSnapshot as RewardProgramSnapshot | undefined;
    if (!snapshot?.referral) {
      throw new BadRequestError('Referral program snapshot missing on enrollment');
    }

    if (!enrollment.referrerUid?.trim() || !enrollment.refereeUid?.trim()) {
      throw new BadRequestError('Enrollment missing referrer or referee uid');
    }

    const qualificationMode = snapshot.referral.qualificationMode;
    if (qualificationMode === 'BOTH_KYC' && usesStaggeredBothKyc(snapshot)) {
      return this.reissueStaggeredBothKyc(enrollmentId, enrollment, snapshot);
    }
    if (qualificationMode === 'BOTH_KYC' || qualificationMode === 'KYC') {
      return this.reissueKycQualification(enrollmentId, enrollment, snapshot, qualificationMode);
    }

    const ctx: ResolveGrantsContext = {
      enrollmentId: enrollment._id.toString(),
      referrerUid: enrollment.referrerUid,
      refereeUid: enrollment.refereeUid,
      referralCode: enrollment.referralCode,
      referralChannel: enrollment.referralChannel
        ? parseReferralChannel(enrollment.referralChannel)
        : undefined,
      referrerWalletRole: parseReferralChannel(
        enrollment.referrerWalletRole ?? enrollment.referralChannel
      ),
      refereeWalletRole: parseReferralChannel(
        enrollment.refereeWalletRole ?? enrollment.referralChannel
      ),
      refereePhoneHash: enrollment.refereePhoneHash,
    };

    const mode = snapshot.referral.qualificationMode;
    const enrollFulfilled =
      Boolean(
        (enrollment as { refereeRewardCredited?: Date | null }).refereeRewardCredited
      ) || String(enrollment.grantsStatus || '').toLowerCase() === 'completed';

    let grants: Awaited<ReturnType<typeof GrantResolver.resolve>> = [];
    if (mode === 'AUTO') {
      grants = [
        ...(await GrantResolver.resolve(snapshot, 'on_enroll', ctx)),
        ...(await GrantResolver.resolve(snapshot, 'on_qualify', ctx)),
      ];
    } else if (
      enrollment.status === ReferralStatus.PENDING &&
      enrollFulfilled &&
      (mode === 'FIRST_PAYMENT' || mode === 'FIRST_TASK')
    ) {
      grants = await GrantResolver.resolve(snapshot, 'on_qualify', ctx);
    } else {
      grants = await GrantResolver.resolve(snapshot, 'on_enroll', ctx);
    }

    logReferralCoins('reissue_start', {
      enrollmentId,
      refereeUid: enrollment.refereeUid,
      referrerUid: enrollment.referrerUid,
      priorGrantsStatus: enrollment.grantsStatus,
      qualificationMode: snapshot.referral.qualificationMode,
      grantCount: grants.length,
      grantsPreview: summarizeGrantsForLog(grants),
    });

    if (grants.length === 0) {
      logger.warn('[ReferralGrantReissue] No grants resolved for reissue', { enrollmentId });
      return {
        grantsStatus: (enrollment.grantsStatus as ReferralGrantsStatus) || 'pending',
        grantsIssued: 0,
        grantsFailed: 0,
        qualified: enrollment.status === ReferralStatus.QUALIFIED,
      };
    }

    const publishResult = await ReferralGrantIssueCoordinator.issue({
      enrollmentId,
      grants,
      refereePhoneHash: enrollment.refereePhoneHash,
      referralChannel: enrollment.referralChannel
        ? parseReferralChannel(enrollment.referralChannel)
        : undefined,
      referrerId: enrollment.referrerId?.toString(),
    });
    const summary = summarizeGrantResults(publishResult.results);
    const grantsStatus = grantsStatusFromSummary(summary);

    let qualified = enrollment.status === ReferralStatus.QUALIFIED;
    const canMarkQualifiedOnReissue =
      mode === 'AUTO' ||
      ((mode === 'FIRST_PAYMENT' || mode === 'FIRST_TASK') && enrollFulfilled);
    if (
      canMarkQualifiedOnReissue &&
      publishResult.grantsFailed === 0 &&
      publishResult.grantsSucceeded > 0 &&
      enrollment.status === ReferralStatus.PENDING
    ) {
      const didQualify = await QualificationEngine.markQualified(enrollmentId);
      qualified = didQualify || qualified;
    }

    logReferralCoins('reissue_done', {
      enrollmentId,
      grantsStatus,
      grantsIssued: publishResult.grantsSucceeded,
      grantsFailed: publishResult.grantsFailed,
      qualified,
    });

    return {
      grantsStatus,
      grantsIssued: publishResult.grantsSucceeded,
      grantsFailed: publishResult.grantsFailed,
      qualified,
    };
  }

  /** Re-runs enroll + qualify legs for staggered BOTH_KYC (referrer + referee). */
  private static async reissueStaggeredBothKyc(
    enrollmentId: string,
    enrollment: {
      _id: { toString(): string };
      referrerUid?: string;
      refereeUid?: string;
      referrerId?: { toString(): string };
      refereePhoneHash?: string;
      referralChannel?: string;
      referralCode?: string;
      status: string;
      grantsStatus?: string;
    },
    snapshot: RewardProgramSnapshot
  ): Promise<ReissueGrantsResult> {
    logReferralCoins('reissue_staggered_start', {
      enrollmentId,
      refereeUid: enrollment.refereeUid,
      referrerUid: enrollment.referrerUid,
      priorGrantsStatus: enrollment.grantsStatus,
    });

    const enrollEvent = createPlatformEvent(
      'REFERRAL_ENROLLED',
      {
        enrollmentId,
        referrerUid: enrollment.referrerUid,
        refereeUid: enrollment.refereeUid,
        referralCode: enrollment.referralCode || '',
      },
      `reissue-enroll:${enrollmentId}:${Date.now()}`
    );
    const enrollResult = await QualificationEngine.processDomainEvent(enrollEvent);

    const identityEvent = createPlatformEvent(
      'IDENTITY_VERIFIED',
      {
        enrollmentId,
        uid: enrollment.refereeUid,
        refereeUid: enrollment.refereeUid,
        referrerUid: enrollment.referrerUid,
        verificationType: 'aadhaar',
        reissue: true,
      },
      `reissue-kyc:${enrollmentId}:${Date.now()}`
    );
    const identityResult = await QualificationEngine.processDomainEvent(identityEvent);

    const updated = await ReferralRecord.findById(enrollmentId).select('grantsStatus status').lean();

    logReferralCoins('reissue_staggered_done', {
      enrollmentId,
      grantsIssued: enrollResult.grantsIssued + identityResult.grantsIssued,
      grantsFailed: enrollResult.grantsFailed + identityResult.grantsFailed,
      qualified: identityResult.qualified,
      grantsStatus: updated?.grantsStatus,
      snapshotMode: snapshot.referral?.qualificationMode,
    });

    return {
      grantsStatus: (updated?.grantsStatus as ReferralGrantsStatus) || 'pending',
      grantsIssued: enrollResult.grantsIssued + identityResult.grantsIssued,
      grantsFailed: enrollResult.grantsFailed + identityResult.grantsFailed,
      qualified: identityResult.qualified || updated?.status === ReferralStatus.QUALIFIED,
    };
  }

  /**
   * Re-runs legacy BOTH_KYC / KYC qualification (both grants on qualify).
   */
  private static async reissueKycQualification(
    enrollmentId: string,
    enrollment: {
      _id: { toString(): string };
      referrerUid?: string;
      refereeUid?: string;
      status: string;
      grantsStatus?: string;
    },
    snapshot: RewardProgramSnapshot,
    qualificationMode: 'BOTH_KYC' | 'KYC'
  ): Promise<ReissueGrantsResult> {
    logReferralCoins('reissue_kyc_start', {
      enrollmentId,
      qualificationMode,
      refereeUid: enrollment.refereeUid,
      referrerUid: enrollment.referrerUid,
      priorGrantsStatus: enrollment.grantsStatus,
      enrollmentStatus: enrollment.status,
    });

    const event = createPlatformEvent(
      'IDENTITY_VERIFIED',
      {
        enrollmentId,
        uid: enrollment.refereeUid,
        refereeUid: enrollment.refereeUid,
        referrerUid: enrollment.referrerUid,
        verificationType: 'aadhaar',
        reissue: true,
      },
      `reissue:${enrollmentId}:${Date.now()}`
    );

    const processResult = await QualificationEngine.processDomainEvent(event);
    const updated = await ReferralRecord.findById(enrollmentId).select('grantsStatus status').lean();

    logReferralCoins('reissue_kyc_done', {
      enrollmentId,
      qualificationMode,
      grantsIssued: processResult.grantsIssued,
      grantsFailed: processResult.grantsFailed,
      qualified: processResult.qualified,
      grantsStatus: updated?.grantsStatus,
      enrollmentStatus: updated?.status,
      snapshotMode: snapshot.referral?.qualificationMode,
    });

    return {
      grantsStatus: (updated?.grantsStatus as ReferralGrantsStatus) || 'pending',
      grantsIssued: processResult.grantsIssued,
      grantsFailed: processResult.grantsFailed,
      qualified: processResult.qualified || updated?.status === ReferralStatus.QUALIFIED,
    };
  }
}
