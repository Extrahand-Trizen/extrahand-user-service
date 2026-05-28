import { Request, Response } from 'express';
import { QualificationEngine } from '../rewards/qualification/QualificationEngine';
import { RewardContextService } from '../rewards/services/RewardContextService';
import { CoinUsageConfigProvider } from '../rewards/config/CoinUsageConfigProvider';
import { createPlatformEvent } from '../rewards/events/InProcessEventBus';
import type { PlatformEventType } from '../rewards/types/PlatformEvent';
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
}
