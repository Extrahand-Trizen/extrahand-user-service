import cron from 'node-cron';
import logger from '../config/logger';
import { ReferralRecord } from '../models/ReferralRecord';
import { ReferralStatus } from '../types/referral';

/**
 * Check for expired referrals daily at 2 AM IST (8:30 PM UTC previous day)
 * Updates all PENDING referrals that have passed their 30-day window to EXPIRED
 */
export function scheduleExpiredReferralCheck() {
  // Run daily at 2:00 AM IST
  // Cron format: minute hour day month dayOfWeek
  // 0 2 * * * = every day at 2:00 AM
  cron.schedule('0 2 * * *', async () => {
    try {
      logger.info('🔄 Starting expired referral check job...');

      const now = new Date();

      const result = await ReferralRecord.updateMany(
        {
          status: ReferralStatus.PENDING,
          expiresAt: { $lt: now }
        },
        {
          status: ReferralStatus.EXPIRED,
          updatedAt: now
        }
      );

      if (result.modifiedCount > 0) {
        logger.info(`✅ Marked ${result.modifiedCount} referrals as expired`);
      } else {
        logger.info('✅ No expired referrals to process');
      }
    } catch (error) {
      logger.error('❌ Error in expired referral check job:', error);
    }
  });

  logger.info('📅 Scheduled expired referral check job (daily at 2 AM IST)');
}
