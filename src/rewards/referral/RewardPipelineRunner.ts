import { createPlatformEvent } from '../events/InProcessEventBus';
import type { ReferralEnrolledPayload } from '../types/PlatformEvent';
import { QualificationEngine } from '../qualification/QualificationEngine';
import logger from '../../config/logger';
import { logReferralCoins } from './referralCoinsLogger';

/**
 * Runs post-enrollment reward pipeline (awaited so signup grants are not lost).
 */
export class RewardPipelineRunner {
  static async runAfterEnroll(params: {
    enrollmentId: string;
    referrerUid: string;
    refereeUid: string;
    referralCode: string;
  }): Promise<{
    grantsIssued: number;
    grantsFailed: number;
    qualified: boolean;
  }> {
    const event = createPlatformEvent<ReferralEnrolledPayload>(
      'REFERRAL_ENROLLED',
      {
        enrollmentId: params.enrollmentId,
        referrerUid: params.referrerUid,
        refereeUid: params.refereeUid,
        referralCode: params.referralCode,
      },
      params.enrollmentId
    );

    logReferralCoins('pipeline_event_start', {
      enrollmentId: params.enrollmentId,
      eventId: event.eventId,
      referrerUid: params.referrerUid,
      refereeUid: params.refereeUid,
      referralCode: params.referralCode,
    });
    try {
      const result = await QualificationEngine.processDomainEvent(event);
      logReferralCoins('pipeline_event_done', {
        enrollmentId: params.enrollmentId,
        grantsIssued: result.grantsIssued,
        grantsFailed: result.grantsFailed,
        qualified: result.qualified,
      });
      return result;
    } catch (err) {
      logReferralCoins(
        'pipeline_event_error',
        {
          enrollmentId: params.enrollmentId,
          correlationId: event.correlationId,
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        },
        'error'
      );
      logger.error('[RewardPipelineRunner] REFERRAL_ENROLLED pipeline failed', {
        enrollmentId: params.enrollmentId,
        correlationId: event.correlationId,
        err,
      });
      return { grantsIssued: 0, grantsFailed: 0, qualified: false };
    }
  }
}
