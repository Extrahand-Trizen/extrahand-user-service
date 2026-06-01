import { createApp } from './app';
import { connectMongo } from './config/database';
import { validateEnv } from './config/env';
import logger from './config/logger';
import { scheduleExpiredReferralCheck } from './jobs/checkExpiredReferrals';
import { scheduleDailyBadgeCheck } from './jobs/dailyBadgeCheck';
import { scheduleDeletionExecutorJob } from './jobs/scheduledDeletionJob';
import { seedRewardProgramIfNeeded } from './rewards/seed/seedRewardProgram';
import { registerRewardEventHandlers } from './rewards/events/registerRewardHandlers';
import { validateRewardsConfiguration } from './rewards/config/rewardsFlags';

const env = validateEnv();

async function startServer() {
  try {
    validateRewardsConfiguration();

    // Connect to MongoDB
    if (env.MONGODB_URI) {
      await connectMongo(env.MONGODB_URI);
      await seedRewardProgramIfNeeded();
      registerRewardEventHandlers();
    } else {
      logger.warn('⚠️ MONGODB_URI not provided, some features may not work');
    }

    // Create Express app
    const app = createApp();

    // Schedule background jobs
    scheduleExpiredReferralCheck();
    scheduleDailyBadgeCheck();
    scheduleDeletionExecutorJob();

    // Start server
    const port = env.PORT;
    app.listen(port, () => {
      logger.info(`🚀 User Service running on port ${port}`);
      logger.info(
        '[REFERRAL_COINS] user-service ready — grep console or logs/combined.log for [REFERRAL_COINS]'
      );
      logger.info(`📝 Environment: ${env.NODE_ENV}`);
      logger.info(`🔗 Health check: http://localhost:${port}/api/v1/health`);
      logger.info(`⏰ Scheduled jobs: Badge checks, referral expiration checks, and deletion executor enabled`);
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      logger.info('SIGTERM signal received: closing HTTP server');
      process.exit(0);
    });

    process.on('SIGINT', () => {
      logger.info('SIGINT signal received: closing HTTP server');
      process.exit(0);
    });

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

