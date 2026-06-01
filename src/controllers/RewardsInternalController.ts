import { Request, Response } from 'express';
import Profile from '../models/Profile';
import { ReferralRecord } from '../models/ReferralRecord';
import { QualificationEngine } from '../rewards/qualification/QualificationEngine';
import { RewardContextService } from '../rewards/services/RewardContextService';
import { CoinUsageConfigProvider } from '../rewards/config/CoinUsageConfigProvider';
import { createPlatformEvent } from '../rewards/events/InProcessEventBus';
import type { PlatformEventType } from '../rewards/types/PlatformEvent';
import { ReferralGrantReissue } from '../rewards/referral/ReferralGrantReissue';
export class RewardsInternalController {
  /**
   * POST /api/v1/user/internal/rewards/process-event
   * Service-auth: domain events for qualification (PAYMENT_COMPLETED, TASK_COMPLETED, etc.)
   */
  static async processEvent(req: Request, res: Response): Promise<void> {
    const { eventType, payload, correlationId } = req.body as {
      eventType: PlatformEventType;
      payload: Record<string, unknown>;
      correlationId?: string;
    };

    if (!eventType || !payload) {
      res.status(400).json({ success: false, error: 'eventType and payload required' });
      return;
    }

    const event = createPlatformEvent(eventType, payload, correlationId);
    const result = await QualificationEngine.processDomainEvent(event);

    res.json({
      success: true,
      data: {
        grantsIssued: result.grantsIssued,
        grantsFailed: result.grantsFailed,
        qualified: result.qualified,
      },
    });
  }

  /**
   * GET /api/v1/user/internal/rewards/coin-usage
   * Service-auth: poster/tasker coin redemption cap percents from RewardProgram.
   */
  static async getCoinUsage(_req: Request, res: Response): Promise<void> {
    const config = await CoinUsageConfigProvider.getConfig();
    res.json({
      success: true,
      data: {
        posterBookingCapPercent: config.poster.redeemCapPercentOfBooking,
        taskerPlatformFeeCapPercent: config.tasker.redeemCapPercentOfPlatformFee,
      },
    });
  }

  /**
   * GET /api/v1/profiles/internal/:uid/reward-context
   */
  static async getRewardContext(req: Request, res: Response): Promise<void> {
    const { uid } = req.params;
    if (!uid) {
      res.status(400).json({ success: false, error: 'uid required' });
      return;
    }
    const context = await RewardContextService.getRewardContext(uid);
    res.json({ success: true, data: context });
  }

  /**
   * GET /api/v1/user/internal/rewards/referral-debug?refereeUid=
   * Service-auth: inspect enrollment + KYC state for referral testing.
   */
  static async getReferralDebug(req: Request, res: Response): Promise<void> {
    const refereeUid = String(req.query.refereeUid || '').trim();
    if (!refereeUid) {
      res.status(400).json({ success: false, error: 'refereeUid query required' });
      return;
    }

    const enrollment = await ReferralRecord.findOne({ refereeUid })
      .sort({ createdAt: -1 })
      .lean();
    if (!enrollment) {
      res.json({ success: true, data: { enrollment: null } });
      return;
    }

    const [referrerProfile, refereeProfile] = await Promise.all([
      enrollment.referrerUid
        ? Profile.findOne({ uid: enrollment.referrerUid })
            .select('uid phone isAadhaarVerified name')
            .lean()
        : null,
      Profile.findOne({ uid: refereeUid }).select('uid phone isAadhaarVerified name').lean(),
    ]);

    res.json({
      success: true,
      data: {
        enrollment: {
          id: String(enrollment._id),
          status: enrollment.status,
          grantsStatus: enrollment.grantsStatus,
          referralCode: enrollment.referralCode,
          qualificationMode: (enrollment.rewardProgramSnapshot as { referral?: { qualificationMode?: string } })
            ?.referral?.qualificationMode,
          referrerUid: enrollment.referrerUid,
          refereeUid: enrollment.refereeUid,
        },
        referrer: referrerProfile,
        referee: refereeProfile,
      },
    });
  }

  /**
   * POST /api/v1/user/internal/rewards/retry-grants
   * Service-auth: re-run grants for enrollment (testing).
   */
  static async retryGrantsInternal(req: Request, res: Response): Promise<void> {
    const enrollmentId = String(req.body?.enrollmentId || '').trim();
    if (!enrollmentId) {
      res.status(400).json({ success: false, error: 'enrollmentId required' });
      return;
    }
    const result = await ReferralGrantReissue.reissue(enrollmentId);
    res.json({ success: true, data: result });
  }
}
