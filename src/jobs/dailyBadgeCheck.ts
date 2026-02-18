import cron from 'node-cron';
import logger from '../config/logger';
import Profile from '../models/Profile';
import { BadgeInfo } from '../models/BadgeInfo';
import { VerificationRecord } from '../models/VerificationRecord';
import { BadgeService } from '../services/badgeService';
import { BadgeLevel } from '../types/badge';
import { statsService } from '../services/StatsService';
import { validateEnv } from '../config/env';

/**
 * Daily badge check job - runs at 2 AM IST every day
 * Checks all users for badge upgrade eligibility and auto-upgrades when applicable
 */
export async function runDailyBadgeCheck(): Promise<void> {
  try {
    logger.info('🔄 Starting daily badge check job...');

    const startTime = Date.now();
    let processedCount = 0;
    let upgradedCount = 0;
    const upgrades: Array<{ userId: string; from: BadgeLevel; to: BadgeLevel }> = [];

    // Get all profiles
    const profiles = await Profile.find({}).select('_id name uid currentBadge platformFeePercentage isActive');

    const env = validateEnv();
    const hasTaskService = env.TASK_SERVICE_URL && env.SERVICE_AUTH_TOKEN;

    for (const profile of profiles) {
      try {
        // Get verifications
        const verifications = await VerificationRecord.find({
          userId: profile._id,
          status: 'verified'
        });

        // Get or create badge info
        let badgeInfo = await BadgeInfo.findOne({ userId: profile._id });
        if (!badgeInfo) {
          badgeInfo = await BadgeInfo.create({
            userId: profile._id,
            currentBadge: BadgeLevel.NONE,
            badgeHistory: []
          });
        }

        // Fetch real-time stats from task-service
        let totalTasksCompleted = 0;
        let totalTasksPosted = 0;
        let averageRating = 0;
        let totalReviews = 0;

        if (hasTaskService) {
          try {
            const stats = await statsService.calculateAllStats(profile._id.toString(), profile.uid);
            totalTasksCompleted = stats.completedTasks || 0;
            totalTasksPosted = stats.postedTasks || 0;
            averageRating = stats.avgRating || 0;
            totalReviews = stats.totalReviews || 0;
          } catch (error: any) {
            logger.warn('Failed to fetch real-time stats in daily badge check', {
              profileId: profile._id,
              error: error.message
            });
          }
        }

        // Map verifications to plain objects for type compatibility
        const mappedVerifications = verifications.map(v => ({
          _id: v._id.toString(),
          userId: v.userId.toString(),
          type: v.type,
          status: v.status,
          verifiedAt: v.verifiedAt,
          expiresAt: v.expiresAt
        }));

        // Calculate current badge level
        const reputationScore = BadgeService.calculateReputationScore({
          verifications: mappedVerifications,
          totalTasksCompleted,
          totalTasksPosted,
          averageRating,
          totalReviews,
          averageResponseTime: 0,
          cancellationRate: 0
        });

        const profileData = {
          currentBadge: badgeInfo.currentBadge,
          verifications: mappedVerifications,
          totalTasksCompleted,
          totalTasksPosted,
          averageRating,
          totalReviews,
          averageResponseTime: 0,
          cancellationRate: 0,
          reputationScore
        };

        const result = await BadgeService.checkAndUpgradeBadge(profile._id.toString(), profileData);

        if (result.upgraded && result.newBadge !== BadgeLevel.ELITE) {
          // Auto-upgrade (not ELITE)
          const newFeePercentage = BadgeService.getPlatformFeePercentage(result.newBadge!);

          await Profile.updateOne(
            { _id: profile._id },
            {
              currentBadge: result.newBadge,
              platformFeePercentage: newFeePercentage
            }
          );

          badgeInfo.badgeHistory.push({
            badge: result.newBadge!,
            achievedAt: new Date(),
            reason: result.reason || 'Automatic upgrade',
            reputationScoreAtTime: profileData.reputationScore.total
          } as any);
          badgeInfo.currentBadge = result.newBadge!;
          badgeInfo.badgeUpgradedAt = new Date();
          badgeInfo.previousBadge = result.previousBadge;
          await badgeInfo.save();

          upgradedCount++;
          upgrades.push({
            userId: profile._id.toString(),
            from: result.previousBadge!,
            to: result.newBadge!
          });

          logger.debug(`✅ User ${profile.uid}: ${result.previousBadge} → ${result.newBadge}`);
        } else if (result.upgraded && result.newBadge === BadgeLevel.ELITE) {
          // Elite requires manual approval - mark as pending review
          logger.debug(`⏳ User ${profile.uid}: Eligible for Elite badge (pending admin review)`);
        }

        processedCount++;
      } catch (userError) {
        logger.error(`Error processing badge for user ${profile._id}:`, userError);
      }
    }

    const durationMs = Date.now() - startTime;

    logger.info(`✅ Daily badge check completed`, {
      processedCount,
      upgradedCount,
      durationMs: `${durationMs}ms`,
      upgrades
    });
  } catch (error) {
    logger.error('❌ Error in daily badge check job:', error);
  }
}

/**
 * Schedule the daily badge check job at 2 AM IST every day
 */
export function scheduleDailyBadgeCheck() {
  // Run daily at 2:00 AM IST (8:30 PM UTC previous day)
  cron.schedule('0 2 * * *', async () => {
    await runDailyBadgeCheck();
  });

  logger.info('📅 Scheduled daily badge check job (daily at 2 AM IST)');
}
