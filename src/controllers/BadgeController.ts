import { Response } from 'express';
import { AuthenticatedRequest } from '../types';
import logger from '../config/logger';
import { Profile } from '../models/Profile';
import { BadgeInfo } from '../models/BadgeInfo';
import { VerificationRecord } from '../models/VerificationRecord';
import { BadgeService, BadgeBatchService } from '../services/badgeService';
import { BadgeLevel } from '../types/badge';

export class BadgeController {
  /**
   * GET /api/v1/user/badge
   */
  static async getUserBadge(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const uid = req.user!.uid;
      const profile = await Profile.findOne({ uid });

      if (!profile) {
        res.status(404).json({ success: false, error: 'User not found' });
        return;
      }

      let badgeInfo = await BadgeInfo.findOne({ userId: profile._id });

      if (!badgeInfo) {
        badgeInfo = await BadgeInfo.create({
          userId: profile._id,
          currentBadge: BadgeLevel.NONE,
          badgeHistory: []
        });
      }

      const verifications = await VerificationRecord.find({
        userId: profile._id,
        status: 'verified'
      });

      // Fetch real-time stats
      let totalTasksCompleted = 0;
      let totalTasksPosted = 0;
      let averageRating = 0;
      let totalReviews = 0;

      try {
        const { validateEnv } = await import('../config/env');
        const env = validateEnv();
        if (env.TASK_SERVICE_URL && env.SERVICE_AUTH_TOKEN && profile._id) {
          const { statsService } = await import('../services/StatsService');
          const stats = await statsService.calculateAllStats(profile._id.toString(), uid);
          
          totalTasksCompleted = stats.completedTasks || 0;
          totalTasksPosted = stats.postedTasks || 0;
          averageRating = stats.avgRating || 0;
          totalReviews = stats.totalReviews || 0;
        }
      } catch (error: any) {
        logger.warn('Failed to fetch real-time stats for badge', { uid, error: error.message });
      }

      const reputationScore = BadgeService.calculateReputationScore({
        verifications,
        totalTasksCompleted,
        totalTasksPosted,
        averageRating,
        totalReviews,
        averageResponseTime: 0,
        cancellationRate: 0
      });

      res.json({
        success: true,
        data: {
          userId: profile._id,
          currentBadge: badgeInfo.currentBadge,
          previousBadge: badgeInfo.previousBadge,
          badgeUpgradedAt: badgeInfo.badgeUpgradedAt,
          reputationScore,
          platformFeePercentage: profile.platformFeePercentage || 5,
          badges: badgeInfo.badgeHistory
        }
      });
    } catch (error: any) {
      logger.error('Error getting user badge:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * GET /api/v1/user/badge/progress
   */
  static async getBadgeProgress(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const uid = req.user!.uid;
      const profile = await Profile.findOne({ uid });

      if (!profile) {
        res.status(404).json({ success: false, error: 'User not found' });
        return;
      }

      let badgeInfo = await BadgeInfo.findOne({ userId: profile._id });
      if (!badgeInfo) {
        badgeInfo = await BadgeInfo.create({
          userId: profile._id,
          currentBadge: BadgeLevel.NONE
        });
      }

      const verifications = await VerificationRecord.find({ userId: profile._id });

      // Fetch real-time stats
      let totalTasksCompleted = 0;
      let totalTasksPosted = 0;
      let averageRating = 0;
      let totalReviews = 0;

      try {
        const { validateEnv } = await import('../config/env');
        const env = validateEnv();
        if (env.TASK_SERVICE_URL && env.SERVICE_AUTH_TOKEN && profile._id) {
          const { statsService } = await import('../services/StatsService');
          const stats = await statsService.calculateAllStats(profile._id.toString(), uid);
          
          totalTasksCompleted = stats.completedTasks || 0;
          totalTasksPosted = stats.postedTasks || 0;
          averageRating = stats.avgRating || 0;
          totalReviews = stats.totalReviews || 0;
        }
      } catch (error: any) {
        logger.warn('Failed to fetch real-time stats for badge progress', { uid, error: error.message });
      }

      const currentBadge = badgeInfo.currentBadge;
      const progressPercentage = BadgeService.calculateProgressToNextBadge(
        {
          verifications,
          totalTasksCompleted,
          totalTasksPosted,
          averageRating,
          totalReviews
        },
        currentBadge
      );

      res.json({
        success: true,
        data: {
          currentBadge,
          progressPercentage,
          verifications: {
            count: verifications.filter(v => v.status === 'verified').length,
            list: verifications.map(v => ({
              type: v.type,
              status: v.status
            }))
          },
          tasksCompleted: totalTasksCompleted,
          averageRating,
          totalReviews
        }
      });
    } catch (error: any) {
      logger.error('Error getting badge progress:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * GET /api/v1/user/reputation-score
   */
  static async getReputationScore(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const uid = req.user!.uid;
      const profile = await Profile.findOne({ uid });

      if (!profile) {
        res.status(404).json({ success: false, error: 'User not found' });
        return;
      }

      const verifications = await VerificationRecord.find({ userId: profile._id });

      // Fetch real-time stats
      let totalTasksCompleted = 0;
      let totalTasksPosted = 0;
      let averageRating = 0;
      let totalReviews = 0;

      try {
        const { validateEnv } = await import('../config/env');
        const env = validateEnv();
        if (env.TASK_SERVICE_URL && env.SERVICE_AUTH_TOKEN && profile._id) {
          const { statsService } = await import('../services/StatsService');
          const stats = await statsService.calculateAllStats(profile._id.toString(), uid);
          
          totalTasksCompleted = stats.completedTasks || 0;
          totalTasksPosted = stats.postedTasks || 0;
          averageRating = stats.avgRating || 0;
          totalReviews = stats.totalReviews || 0;
        }
      } catch (error: any) {
        logger.warn('Failed to fetch real-time stats for reputation score', { uid, error: error.message });
      }

      const breakdown = BadgeService.calculateReputationScore({
        verifications,
        totalTasksCompleted,
        totalTasksPosted,
        averageRating,
        totalReviews,
        averageResponseTime: 0,
        cancellationRate: 0
      });

      res.json({ success: true, data: breakdown });
    } catch (error: any) {
      logger.error('Error getting reputation score:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * POST /api/v1/user/badge/check-upgrade
   */
  static async checkBadgeUpgrade(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const uid = req.user!.uid;
      const profile = await Profile.findOne({ uid });

      if (!profile) {
        res.status(404).json({ success: false, error: 'User not found' });
        return;
      }

      let badgeInfo = await BadgeInfo.findOne({ userId: profile._id });
      if (!badgeInfo) {
        badgeInfo = await BadgeInfo.create({
          userId: profile._id,
          currentBadge: BadgeLevel.NONE
        });
      }

      const verifications = await VerificationRecord.find({ userId: profile._id });

      // Fetch real-time stats
      let totalTasksCompleted = 0;
      let totalTasksPosted = 0;
      let averageRating = 0;
      let totalReviews = 0;

      try {
        const { validateEnv } = await import('../config/env');
        const env = validateEnv();
        if (env.TASK_SERVICE_URL && env.SERVICE_AUTH_TOKEN && profile._id) {
          const { statsService } = await import('../services/StatsService');
          const stats = await statsService.calculateAllStats(profile._id.toString(), uid);
          
          totalTasksCompleted = stats.completedTasks || 0;
          totalTasksPosted = stats.postedTasks || 0;
          averageRating = stats.avgRating || 0;
          totalReviews = stats.totalReviews || 0;
        }
      } catch (error: any) {
        logger.warn('Failed to fetch real-time stats for badge check', { uid, error: error.message });
      }

      const reputationScore = BadgeService.calculateReputationScore({
        verifications,
        totalTasksCompleted,
        totalTasksPosted,
        averageRating,
        totalReviews,
        averageResponseTime: 0,
        cancellationRate: 0
      });

      const profileData = {
        currentBadge: badgeInfo.currentBadge,
        verifications,
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
        // Auto-upgrade for all badges except ELITE
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
        });
        badgeInfo.currentBadge = result.newBadge!;
        badgeInfo.badgeUpgradedAt = new Date();
        badgeInfo.previousBadge = result.previousBadge;
        await badgeInfo.save();

        logger.info('✅ Badge upgraded', {
          userId: profile._id,
          from: result.previousBadge,
          to: result.newBadge,
          reason: result.reason
        });

        res.json({
          success: true,
          data: {
            ...result,
            message: `Congratulations! You've been upgraded to ${result.newBadge} badge.`
          }
        });
      } else if (result.upgraded && result.newBadge === BadgeLevel.ELITE) {
        // Elite requires manual approval
        logger.info('Elite badge eligibility', {
          userId: profile._id,
          requiresApproval: true
        });

        res.json({
          success: true,
          data: {
            ...result,
            message: 'You qualify for Elite badge! Your profile is under admin review.'
          }
        });
      } else {
        res.json({
          success: true,
          data: {
            upgraded: false,
            message: 'No badge upgrade at this time. Keep up the good work!'
          }
        });
      }
    } catch (error: any) {
      logger.error('Error checking badge upgrade:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * GET /api/v1/badge/tier-config/:badgeLevel
   */
  static async getBadgeTierConfig(req: any, res: Response): Promise<void> {
    try {
      const { badgeLevel } = req.params;

      if (!Object.values(BadgeLevel).includes(badgeLevel)) {
        res.status(404).json({ success: false, error: 'Invalid badge level' });
        return;
      }

      const config = BadgeService.getBadgeTierConfig(badgeLevel);

      res.json({ success: true, data: config });
    } catch (error: any) {
      logger.error('Error getting badge tier config:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * POST /api/v1/admin/badge/approve-elite
   */
  static async approveEliteBadge(req: any, res: Response): Promise<void> {
    try {
      // Check if user is admin
      if (!req.user?.isAdmin) {
        res.status(403).json({ success: false, error: 'Insufficient permissions' });
        return;
      }

      const { userId, approve, reviewNotes } = req.body;
      const adminId = req.user.id;

      const profile = await Profile.findById(userId);
      if (!profile) {
        res.status(404).json({ success: false, error: 'User not found' });
        return;
      }

      let badgeInfo = await BadgeInfo.findOne({ userId });
      if (!badgeInfo) {
        res.status(404).json({ success: false, error: 'Badge info not found' });
        return;
      }

      if (approve) {
        await Profile.updateOne({ _id: userId }, { currentBadge: BadgeLevel.ELITE, platformFeePercentage: 3 });

        badgeInfo.badgeHistory.push({
          badge: BadgeLevel.ELITE,
          achievedAt: new Date(),
          reason: 'Manually approved by admin',
          reputationScoreAtTime: 0
        });
        badgeInfo.currentBadge = BadgeLevel.ELITE;
        badgeInfo.badgeUpgradedAt = new Date();
        badgeInfo.eliteApprovedBy = adminId;
        badgeInfo.eliteApprovedAt = new Date();
        await badgeInfo.save();

        logger.info('Elite badge approved', { userId, approvedBy: adminId });

        res.json({
          success: true,
          data: { userId, badge: BadgeLevel.ELITE, approved: true }
        });
      } else {
        badgeInfo.eliteRejectionReason = reviewNotes;
        await badgeInfo.save();

        logger.info('Elite badge rejected', { userId, reason: reviewNotes });

        res.json({
          success: true,
          data: { userId, badge: BadgeLevel.ELITE, approved: false, rejectionReason: reviewNotes }
        });
      }
    } catch (error: any) {
      logger.error('Error approving elite badge:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }
}
