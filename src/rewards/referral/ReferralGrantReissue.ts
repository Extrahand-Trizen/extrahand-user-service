import { ReferralRecord } from '../../models/ReferralRecord';
import { ReferralStatus } from '../../types/referral';
import { NotFoundError, BadRequestError } from '../../errors/AppError';
import type { RewardProgramSnapshot } from '../types/RewardProgram';
import type { ReferralGrantsStatus } from '../types/GrantsStatus';
import { GrantResolver, type ResolveGrantsContext } from '../grants/GrantResolver';
import { GrantCommandPublisher } from '../publishers/GrantCommandPublisher';
import { QualificationEngine } from '../qualification/QualificationEngine';
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
    };

    let grants = await GrantResolver.resolve(snapshot, 'on_enroll', ctx);
    if (snapshot.referral.qualificationMode === 'AUTO') {
      grants = [...grants, ...(await GrantResolver.resolve(snapshot, 'on_qualify', ctx))];
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

    const publishResult = await GrantCommandPublisher.issueGrants(grants, { enrollmentId });
    const summary = summarizeGrantResults(publishResult.results);
    const grantsStatus = grantsStatusFromSummary(summary);

    let qualified = enrollment.status === ReferralStatus.QUALIFIED;
    if (
      snapshot.referral.qualificationMode === 'AUTO' &&
      publishResult.grantsFailed === 0 &&
      publishResult.grantsSucceeded > 0
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
}
