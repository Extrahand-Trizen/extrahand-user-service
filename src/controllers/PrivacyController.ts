import { Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { PrivacyService } from '../services/PrivacyService';
import { validateEnv } from '../config/env';
import logger from '../config/logger';
import { triggerDeletionExecutorWakeup } from '../jobs/scheduledDeletionJob';

const env = validateEnv();

function getClientIp(req: AuthenticatedRequest): string {
  return req.ip || (req as any).connection?.remoteAddress || 'unknown';
}

export class PrivacyController {
  /**
   * GET /api/v1/privacy/data-export
   */
  static async exportData(req: AuthenticatedRequest, res: Response): Promise<void> {
    const userId = req.user!.uid;
    const exportData = await PrivacyService.exportUserData(
      userId,
      env.TASK_SERVICE_URL,
      env.MESSAGING_SERVICE_URL,
      env.SERVICE_AUTH_TOKEN || ''
    );

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="extrahand-data-export-${userId}-${Date.now()}.json"`);

    res.json(exportData);
  }

  /**
   * GET /api/v1/privacy/dashboard
   */
  static async getDashboard(req: AuthenticatedRequest, res: Response): Promise<void> {
    const userId = req.user!.uid;
    const dashboard = await PrivacyService.getPrivacyDashboard(
      userId,
      env.TASK_SERVICE_URL,
      env.MESSAGING_SERVICE_URL,
      env.SERVICE_AUTH_TOKEN || ''
    );

    res.json({
      success: true,
      dashboard
    });
  }

  /**
   * POST /api/v1/privacy/consent
   */
  static async updateConsent(req: AuthenticatedRequest, res: Response): Promise<void> {
    const userId = req.user!.uid;
    const { consentType, value, reason } = req.body;

    await PrivacyService.updateConsent(
      userId,
      consentType,
      value,
      getClientIp(req),
      req.get('user-agent') || '',
      reason
    );

    res.json({
      success: true,
      message: 'Consent updated successfully',
      consent: {
        type: consentType,
        value,
        updatedAt: new Date()
      }
    });
  }

  /**
   * GET /api/v1/privacy/consent
   */
  static async getConsent(req: AuthenticatedRequest, res: Response): Promise<void> {
    const userId = req.user!.uid;
    const consent = await PrivacyService.getConsent(
      userId,
      getClientIp(req),
      req.get('user-agent') || ''
    );

    res.json({
      success: true,
      consent
    });
  }

  /**
   * GET /api/v1/privacy/deletion-preview
   */
  static async getDeletionPreview(req: AuthenticatedRequest, res: Response): Promise<void> {
    const userId = req.user!.uid;
    const preview = await PrivacyService.getAccountDeletionPreview(userId);

    res.json({
      success: true,
      ...preview,
    });
  }

  /**
   * GET /api/v1/privacy/open-tasks-count
   */
  static async getOpenTasksCount(req: AuthenticatedRequest, res: Response): Promise<void> {
    const userId = req.user!.uid;
    const openTasksCount = await PrivacyService.getOpenTasksCount(
      userId,
      env.TASK_SERVICE_URL,
      env.SERVICE_AUTH_TOKEN || ''
    );

    res.json({
      success: true,
      openTasksCount
    });
  }

  /**
   * DELETE /api/v1/privacy/delete-account
   */
  static async requestDeletion(req: AuthenticatedRequest, res: Response): Promise<void> {
    const userId = req.user!.uid;
    const { confirm, reason } = req.body;

    logger.info('Delete-account API called', {
      userId,
      confirm: Boolean(confirm),
      hasReason: Boolean(reason && String(reason).trim())
    });

    if (!confirm) {
      logger.warn('Delete-account API rejected: confirmation missing', { userId });
      res.status(400).json({
        success: false,
        error: 'Confirmation required',
        message: 'Please confirm account deletion by sending { "confirm": true }'
      });
      return;
    }

    const { deletedAt, cascadeDeleteResult } = await PrivacyService.requestAccountDeletion(userId, reason);

    logger.info('Delete-account API completed immediate deletion', {
      userId,
      deletedAt,
      cascadeDeleteResult,
    });

    res.json({
      success: true,
      message: 'Account deleted successfully',
      deletedAt,
      cascadeDeleteResult,
    });
  }

  /**
   * POST /api/v1/privacy/cancel-deletion
   */
  static async cancelDeletion(req: AuthenticatedRequest, res: Response): Promise<void> {
    const userId = req.user!.uid;
    await PrivacyService.cancelAccountDeletion(
      userId,
      getClientIp(req),
      req.get('user-agent') || ''
    );
    triggerDeletionExecutorWakeup();

    res.json({
      success: true,
      message: 'Account deletion has been cancelled',
      accountStatus: 'active'
    });
  }

  /**
   * POST /api/v1/privacy/execute-deletion (Internal/Cron job)
   * Actually delete accounts that have passed the grace period
   */
  static async executeDeletion(_req: AuthenticatedRequest, res: Response): Promise<void> {
    // TODO: Add admin auth check or service auth check
    // For now, this should be protected by service auth token
    
    const result = await PrivacyService.executeScheduledDeletions(
      env.TASK_SERVICE_URL,
      env.MESSAGING_SERVICE_URL,
      env.SERVICE_AUTH_TOKEN || ''
    );

    // Old format: return success, deletedCount, failedCount, results
    res.json({
      success: true,
      deletedCount: result.deletedCount,
      failedCount: result.failedCount,
      results: result.results
    });
  }
}


