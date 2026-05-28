import { ReferralRecord } from '../../models/ReferralRecord';
import { ReferralStatus } from '../../types/referral';
import type { RewardProgramSnapshot, QualificationMode } from '../types/RewardProgram';
import type { PlatformEvent, PaymentCompletedPayload, TaskCompletedPayload } from '../types/PlatformEvent';
import { GrantResolver, type ResolveGrantsContext } from '../grants/GrantResolver';
import type { GrantSpec } from '../types/GrantSpec';
import { rewardsFlags } from '../config/rewardsFlags';
import { logReferralCoins, summarizeGrantsForLog } from '../referral/referralCoinsLogger';
import { parseReferralChannel } from '../utils/walletRole';

export interface QualificationEvaluation {
  shouldQualify: boolean;
  grants: GrantSpec[];
  reason?: string;
}

export class QualificationEngine {
  static async evaluateForEventAsync(
    enrollment: {
      _id: string;
      referrerUid?: string;
      refereeUid?: string;
      referralCode: string;
      referralChannel?: 'poster' | 'tasker' | 'customer';
      status: string;
      expiresAt: Date;
      rewardProgramSnapshot?: RewardProgramSnapshot;
    },
    event: PlatformEvent
  ): Promise<QualificationEvaluation> {
    const snapshot = enrollment.rewardProgramSnapshot;
    if (!snapshot?.referral) {
      return { shouldQualify: false, grants: [], reason: 'missing_snapshot' };
    }

    const mode = snapshot.referral.qualificationMode;
    const ctx = this.buildContext(enrollment);

    if (event.eventType === 'REFERRAL_ENROLLED') {
      return this.evaluateAutoOnEnroll(enrollment, snapshot, ctx, mode);
    }

    if (!rewardsFlags.REWARDS_EXTENDED_QUALIFICATION) {
      return { shouldQualify: false, grants: [], reason: 'extended_qualification_disabled' };
    }

    if (event.eventType === 'PAYMENT_COMPLETED' && mode === 'FIRST_PAYMENT') {
      return this.evaluateFirstPayment(
        enrollment,
        snapshot,
        ctx,
        event.payload as unknown as PaymentCompletedPayload
      );
    }

    if (event.eventType === 'TASK_COMPLETED' && mode === 'FIRST_TASK') {
      return this.evaluateFirstTask(
        enrollment,
        snapshot,
        ctx,
        event.payload as unknown as TaskCompletedPayload
      );
    }

    if (event.eventType === 'IDENTITY_VERIFIED' && mode === 'KYC') {
      return this.evaluateKyc(enrollment, snapshot, ctx, event.payload as { refereeUid?: string });
    }

    return { shouldQualify: false, grants: [], reason: 'mode_mismatch' };
  }

  private static buildContext(enrollment: {
    _id: string;
    referrerUid?: string;
    refereeUid?: string;
    referralCode: string;
    referralChannel?: 'poster' | 'tasker' | 'customer';
    referrerWalletRole?: 'poster' | 'tasker' | 'customer';
    refereeWalletRole?: 'poster' | 'tasker' | 'customer';
  }): ResolveGrantsContext {
    const channel = parseReferralChannel(enrollment.referralChannel);
    return {
      enrollmentId: enrollment._id.toString(),
      referrerUid: enrollment.referrerUid || '',
      refereeUid: enrollment.refereeUid || '',
      referralCode: enrollment.referralCode,
      referralChannel: channel,
      referrerWalletRole: parseReferralChannel(
        enrollment.referrerWalletRole ?? enrollment.referralChannel
      ),
      refereeWalletRole: parseReferralChannel(
        enrollment.refereeWalletRole ?? enrollment.referralChannel
      ),
    };
  }

  private static async evaluateAutoOnEnroll(
    enrollment: { status: string },
    snapshot: RewardProgramSnapshot,
    ctx: ResolveGrantsContext,
    mode: QualificationMode
  ): Promise<QualificationEvaluation> {
    if (mode !== 'AUTO') {
      const enrollGrants = await GrantResolver.resolve(snapshot, 'on_enroll', ctx);
      return { shouldQualify: false, grants: enrollGrants, reason: 'pending_non_auto' };
    }

    if (enrollment.status !== ReferralStatus.PENDING) {
      return { shouldQualify: false, grants: [], reason: 'not_pending' };
    }

    const enrollGrants = await GrantResolver.resolve(snapshot, 'on_enroll', ctx);
    const qualifyGrants = await GrantResolver.resolve(snapshot, 'on_qualify', ctx);
    return {
      shouldQualify: true,
      grants: [...enrollGrants, ...qualifyGrants],
    };
  }

  private static async evaluateFirstPayment(
    enrollment: { refereeUid?: string; expiresAt: Date; status: string },
    snapshot: RewardProgramSnapshot,
    ctx: ResolveGrantsContext,
    payload: PaymentCompletedPayload
  ): Promise<QualificationEvaluation> {
    if (enrollment.status !== ReferralStatus.PENDING) {
      return { shouldQualify: false, grants: [] };
    }
    if (new Date() > enrollment.expiresAt) {
      return { shouldQualify: false, grants: [], reason: 'expired' };
    }
    if (payload.posterUid !== enrollment.refereeUid) {
      return { shouldQualify: false, grants: [], reason: 'referee_not_poster' };
    }
    ctx.taskId = payload.taskId;
    ctx.platformFeeInr = payload.platformFeeInr;
    const grants = await GrantResolver.resolve(snapshot, 'on_qualify', ctx);
    return { shouldQualify: grants.length > 0, grants };
  }

  private static async evaluateFirstTask(
    enrollment: { refereeUid?: string; expiresAt: Date; status: string },
    snapshot: RewardProgramSnapshot,
    ctx: ResolveGrantsContext,
    payload: TaskCompletedPayload
  ): Promise<QualificationEvaluation> {
    if (enrollment.status !== ReferralStatus.PENDING) {
      return { shouldQualify: false, grants: [] };
    }
    if (new Date() > enrollment.expiresAt) {
      return { shouldQualify: false, grants: [], reason: 'expired' };
    }
    if (payload.performerUid !== enrollment.refereeUid) {
      return { shouldQualify: false, grants: [], reason: 'referee_not_performer' };
    }
    ctx.taskId = payload.taskId;
    const grants = await GrantResolver.resolve(snapshot, 'on_qualify', ctx);
    return { shouldQualify: grants.length > 0, grants };
  }

  private static async evaluateKyc(
    enrollment: { refereeUid?: string; expiresAt: Date; status: string },
    snapshot: RewardProgramSnapshot,
    ctx: ResolveGrantsContext,
    payload: { refereeUid?: string }
  ): Promise<QualificationEvaluation> {
    if (enrollment.status !== ReferralStatus.PENDING) {
      return { shouldQualify: false, grants: [] };
    }
    if (new Date() > enrollment.expiresAt) {
      return { shouldQualify: false, grants: [], reason: 'expired' };
    }
    if (payload.refereeUid && payload.refereeUid !== enrollment.refereeUid) {
      return { shouldQualify: false, grants: [], reason: 'uid_mismatch' };
    }
    const grants = await GrantResolver.resolve(snapshot, 'on_qualify', ctx);
    return { shouldQualify: grants.length > 0, grants };
  }

  /** Atomic PENDING → QUALIFIED */
  static async markQualified(enrollmentId: string, taskId?: string): Promise<boolean> {
    const result = await ReferralRecord.updateOne(
      { _id: enrollmentId, status: ReferralStatus.PENDING },
      {
        $set: {
          status: ReferralStatus.QUALIFIED,
          qualifiedDate: new Date(),
          ...(taskId ? { qualifyingTaskId: taskId } : {}),
        },
      }
    );
    return result.modifiedCount === 1;
  }

  static async processDomainEvent(event: PlatformEvent): Promise<{
    grantsIssued: number;
    grantsFailed: number;
    qualified: boolean;
  }> {
    const payload = event.payload as {
      enrollmentId?: string;
      refereeUid?: string;
      referrerUid?: string;
    };

    let enrollment = null;
    if (payload.enrollmentId) {
      enrollment = await ReferralRecord.findById(payload.enrollmentId);
    } else if (payload.refereeUid) {
      enrollment = await ReferralRecord.findOne({
        refereeUid: payload.refereeUid,
        status: ReferralStatus.PENDING,
      });
    } else if (event.eventType === 'PAYMENT_COMPLETED') {
      const posterUid = (event.payload as { posterUid?: string }).posterUid;
      if (posterUid) {
        enrollment = await ReferralRecord.findOne({
          refereeUid: posterUid,
          status: ReferralStatus.PENDING,
        });
      }
    }

    if (!enrollment) {
      logReferralCoins(
        'qualification_no_enrollment',
        {
          eventType: event.eventType,
          enrollmentId: payload.enrollmentId,
          refereeUid: payload.refereeUid,
          referrerUid: payload.referrerUid,
        },
        'warn'
      );
      return { grantsIssued: 0, grantsFailed: 0, qualified: false };
    }

    const evalResult = await this.evaluateForEventAsync(
      {
        _id: enrollment._id.toString(),
        referrerUid: enrollment.referrerUid,
        refereeUid: enrollment.refereeUid,
        referralCode: enrollment.referralCode,
        referralChannel: (enrollment as { referralChannel?: 'poster' | 'tasker' | 'customer' })
          .referralChannel,
        status: enrollment.status,
        expiresAt: enrollment.expiresAt,
        rewardProgramSnapshot: enrollment.rewardProgramSnapshot as RewardProgramSnapshot | undefined,
      },
      event
    );

    const { GrantCommandPublisher } = await import('../publishers/GrantCommandPublisher');

    const grantsToIssue = evalResult.grants;
    let qualified = enrollment.status === ReferralStatus.QUALIFIED;
    const shouldMarkQualifiedOnSuccess = evalResult.shouldQualify;
    const enrollmentId = enrollment._id.toString();

    logReferralCoins('qualification_evaluated', {
      enrollmentId,
      eventType: event.eventType,
      shouldQualify: evalResult.shouldQualify,
      reason: evalResult.reason,
      enrollmentStatus: enrollment.status,
      grantCount: grantsToIssue.length,
      grantsPreview: summarizeGrantsForLog(grantsToIssue),
    });

    if (
      event.eventType !== 'REFERRAL_ENROLLED' &&
      grantsToIssue.length === 0
    ) {
      return { grantsIssued: 0, grantsFailed: 0, qualified };
    }

    if (event.eventType === 'REFERRAL_ENROLLED' && grantsToIssue.length === 0) {
      logReferralCoins(
        'qualification_no_grants',
        { enrollmentId, eventType: event.eventType, reason: evalResult.reason },
        'warn'
      );
      return { grantsIssued: 0, grantsFailed: 0, qualified };
    }

    if (event.eventType !== 'REFERRAL_ENROLLED' && !shouldMarkQualifiedOnSuccess) {
      return { grantsIssued: 0, grantsFailed: 0, qualified };
    }

    if (grantsToIssue.length === 0) {
      return { grantsIssued: 0, grantsFailed: 0, qualified };
    }

    const publishResult = await GrantCommandPublisher.issueGrants(grantsToIssue, {
      enrollmentId,
    });

    if (
      shouldMarkQualifiedOnSuccess &&
      publishResult.grantsFailed === 0 &&
      publishResult.grantsSucceeded > 0
    ) {
      const didQualify = await this.markQualified(
        enrollmentId,
        (event.payload as { taskId?: string }).taskId
      );
      qualified = didQualify || qualified;
      logReferralCoins('qualification_mark_qualified', {
        enrollmentId,
        didQualify,
        qualified,
      });
    }

    return {
      grantsIssued: publishResult.grantsSucceeded,
      grantsFailed: publishResult.grantsFailed,
      qualified,
    };
  }
}
