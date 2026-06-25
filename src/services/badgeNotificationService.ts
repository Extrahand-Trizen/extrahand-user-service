/**
 * Badge Notification Service
 * Sends notifications when user's badge is upgraded
 */

import logger from '../config/logger';
import { validateEnv } from '../config/env';

export interface BadgeUpgradeNotification {
  userId: string;
  uid: string;
  name: string;
  previousBadge: string;
  newBadge: string;
  newTier: number;
}

export class BadgeNotificationService {
  /**
   * Send notification when user's verification badge is upgraded
   */
  static async sendBadgeUpgradeNotification(data: BadgeUpgradeNotification): Promise<void> {
    try {
      const env = validateEnv();
      const notificationServiceUrl = process.env.NOTIFICATION_SERVICE_URL;
      
      if (!notificationServiceUrl || !env.SERVICE_AUTH_TOKEN) {
        logger.warn('Notification service not configured, skipping badge upgrade notification');
        return;
      }

      const badgeLabels: Record<string, string> = {
        'none': 'No Badge',
        'basic': 'Basic',
        'verified': 'Verified',
        'trusted': 'Trusted',
        'elite': 'Elite'
      };

      const title = '🎖️ Badge Upgraded!';
      const body = `Congratulations! Your verification badge has been upgraded from ${badgeLabels[data.previousBadge]} to ${badgeLabels[data.newBadge]}.`;

      // Send push notification via notification service
      const response = await fetch(`${notificationServiceUrl}/api/v1/notifications/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Service-Auth': env.SERVICE_AUTH_TOKEN,
          'x-service-name': 'user-service'
        },
        body: JSON.stringify({
          userId: data.userId,
          notification: {
            title,
            body,
            type: 'badge_upgrade',
            category: 'accountActivity',
            data: {
              previousBadge: data.previousBadge,
              newBadge: data.newBadge,
              newTier: data.newTier
            }
          }
        })
      });

      if (!response.ok) {
        const error = await response.text();
        logger.error('Failed to send badge upgrade notification:', { error, status: response.status });
        return;
      }

      logger.info('✅ Badge upgrade notification sent', {
        userId: data.userId,
        uid: data.uid,
        from: data.previousBadge,
        to: data.newBadge
      });

    } catch (error: any) {
      logger.error('Error sending badge upgrade notification:', error);
      // Don't throw - notification failures shouldn't block badge upgrades
    }
  }

  /**
   * Send notification when reputation badge is upgraded (5-tier system)
   */
  static async sendReputationBadgeUpgradeNotification(data: BadgeUpgradeNotification): Promise<void> {
    try {
      const env = validateEnv();
      const notificationServiceUrl = process.env.NOTIFICATION_SERVICE_URL;
      
      if (!notificationServiceUrl || !env.SERVICE_AUTH_TOKEN) {
        logger.warn('Notification service not configured');
        return;
      }

      const badgeLabels: Record<string, string> = {
        'none': 'New User',
        'basic': 'Basic Member',
        'verified': 'Verified',
        'trusted': 'Trusted',
        'elite': 'Elite'
      };

      const benefits: Record<string, string> = {
        'basic': 'You can now apply and post tasks.',
        'verified': 'Enjoy lower fees (4.5%) and better visibility.',
        'trusted': 'Get featured placement, 4% fees, and instant payouts.',
        'elite': 'Premium tier with 3% fees and exclusive benefits.'
      };

      const title = '🌟 Reputation Badge Upgraded!';
      const body = `You've earned the ${badgeLabels[data.newBadge]} badge! ${benefits[data.newBadge] || ''}`;

      await fetch(`${notificationServiceUrl}/api/v1/notifications/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Service-Auth': env.SERVICE_AUTH_TOKEN,
          'x-service-name': 'user-service'
        },
        body: JSON.stringify({
          userId: data.userId,
          notification: {
            title,
            body,
            type: 'reputation_badge_upgrade',
            category: 'accountActivity',
            data: {
              previousBadge: data.previousBadge,
              newBadge: data.newBadge
            }
          }
        })
      });

      logger.info('✅ Reputation badge upgrade notification sent', {
        userId: data.userId,
        uid: data.uid,
        badge: data.newBadge
      });

    } catch (error: any) {
      logger.error('Error sending reputation badge upgrade notification:', error);
    }
  }

  /**
   * Send notification when Elite badge application is approved
   */
  static async sendEliteApprovalNotification(userId: string, uid: string, name: string): Promise<void> {
    try {
      const env = validateEnv();
      const notificationServiceUrl = process.env.NOTIFICATION_SERVICE_URL;
      
      if (!notificationServiceUrl || !env.SERVICE_AUTH_TOKEN) {
        return;
      }

      const title = '🏆 Elite Badge Approved!';
      const body = `Congratulations ${name}! Your Elite badge application has been approved. Welcome to the elite tier!`;

      await fetch(`${notificationServiceUrl}/api/v1/notifications/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Service-Auth': env.SERVICE_AUTH_TOKEN,
          'x-service-name': 'user-service'
        },
        body: JSON.stringify({
          userId,
          notification: {
            title,
            body,
            type: 'elite_badge_approved',
            category: 'accountActivity',
            data: {
              badge: 'elite'
            }
          }
        })
      });

      logger.info('✅ Elite badge approval notification sent', { userId, uid });

    } catch (error: any) {
      logger.error('Error sending elite approval notification:', error);
    }
  }

  /**
   * Send notification when Elite badge application is rejected
   */
  static async sendEliteRejectionNotification(
    userId: string, 
    uid: string, 
    _name: string,
    reason?: string
  ): Promise<void> {
    try {
      const env = validateEnv();
      const notificationServiceUrl = process.env.NOTIFICATION_SERVICE_URL;
      
      if (!notificationServiceUrl || !env.SERVICE_AUTH_TOKEN) {
        return;
      }

      const title = 'Elite Badge Application Update';
      const body = reason 
        ? `Your Elite badge application requires some improvements. Reason: ${reason}`
        : 'Your Elite badge application was not approved at this time. Keep up the great work and apply again later!';

      await fetch(`${notificationServiceUrl}/api/v1/notifications/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Service-Auth': env.SERVICE_AUTH_TOKEN,
          'x-service-name': 'user-service'
        },
        body: JSON.stringify({
          userId,
          notification: {
            title,
            body,
            type: 'elite_badge_rejected',
            category: 'accountActivity',
            data: {
              reason: reason || 'Not specified'
            }
          }
        })
      });

      logger.info('Elite badge rejection notification sent', { userId, uid });

    } catch (error: any) {
      logger.error('Error sending elite rejection notification:', error);
    }
  }
}
