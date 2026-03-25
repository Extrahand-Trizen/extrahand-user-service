import { Response } from 'express';
import { AuthenticatedRequest } from '../types';
import logger from '../config/logger';
import Profile from '../models/Profile';
import { BadgeInfo } from '../models/BadgeInfo';
import { BadgeService } from '../services/badgeService';
import { BadgeLevel, VerificationType } from '../types/badge';
import { BadgeNotificationService } from '../services/badgeNotificationService';

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

      // Ensure phone verification is set if phone exists
      if (!profile.phoneVerified && profile.phone && profile.phone.length > 0) {
        profile.phoneVerified = true;
        await profile.save();
        logger.info(`Updated phoneVerified for user ${uid} in getUserBadge`);
      }

      // Build verification data from Profile model
      const verifications = [
        ...(profile.isEmailVerified ? [{ type: VerificationType.EMAIL, status: 'verified' }] : []),
        ...(profile.phoneVerified ? [{ type: VerificationType.PHONE, status: 'verified' }] : []),
        ...(profile.isAadhaarVerified ? [{ type: VerificationType.AADHAAR, status: 'verified' }] : []),
        ...(profile.isPANVerified ? [{ type: VerificationType.PAN, status: 'verified' }] : []),
        ...(profile.isBankVerified ? [{ type: VerificationType.BANK, status: 'verified' }] : []),
      ];

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

      // Check if badge can be upgraded based on current profile
      const newBadgeLevel = BadgeService.determineBadgeLevel({
        verifications: verifications as any,
        totalTasksCompleted,
        totalTasksPosted,
        averageRating,
        totalReviews
      });

      // Update badge if it changed
      if (newBadgeLevel !== badgeInfo.currentBadge) {
        logger.info(`Badge upgraded for user ${uid}: ${badgeInfo.currentBadge} → ${newBadgeLevel}`);
        badgeInfo.currentBadge = newBadgeLevel;
        await badgeInfo.save();
      }

      const reputationScore = BadgeService.calculateReputationScore({
        verifications: verifications as any,
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
          platformFeePercentage: 5,
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

      // Ensure phone verification is set if phone exists
      if (!profile.phoneVerified && profile.phone && profile.phone.length > 0) {
        profile.phoneVerified = true;
        await profile.save();
        logger.info(`Updated phoneVerified for user ${uid}`);
      }

      // Build verification data from Profile model
      const verifications = [
        ...(profile.isEmailVerified ? [{ type: VerificationType.EMAIL, status: 'verified' }] : []),
        ...(profile.phoneVerified ? [{ type: VerificationType.PHONE, status: 'verified' }] : []),
        ...(profile.isAadhaarVerified ? [{ type: VerificationType.AADHAAR, status: 'verified' }] : []),
        ...(profile.isPANVerified ? [{ type: VerificationType.PAN, status: 'verified' }] : []),
        ...(profile.isBankVerified ? [{ type: VerificationType.BANK, status: 'verified' }] : []),
      ];

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

      // Check if badge can be upgraded based on current profile
      const newBadgeLevel = BadgeService.determineBadgeLevel({
        verifications: verifications as any,
        totalTasksCompleted,
        totalTasksPosted,
        averageRating,
        totalReviews
      });

      // Update badge if it changed
      let currentBadge = badgeInfo.currentBadge;
      if (newBadgeLevel !== currentBadge) {
        logger.info(`Badge upgraded for user ${uid}: ${currentBadge} → ${newBadgeLevel}`);
        badgeInfo.currentBadge = newBadgeLevel;
        await badgeInfo.save();
        currentBadge = newBadgeLevel;
      }

      const progressPercentage = BadgeService.calculateProgressToNextBadge(
        {
          verifications: verifications as any,
          totalTasksCompleted,
          totalTasksPosted,
          averageRating,
          totalReviews
        },
        currentBadge
      );

      // Calculate current reputation score
      const currentReputation = BadgeService.calculateReputationScore({
        verifications: verifications as any,
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
          currentBadge,
          currentReputation: currentReputation.total,
          progressPercentage,
          reputationBreakdown: {
            verifications: currentReputation.verifications,
            performance: currentReputation.performance,
            reviews: currentReputation.reviews,
            reliability: currentReputation.reliability,
            total: currentReputation.total
          },
          badgeRequirements: {
            none: {
              minReputation: 0,
              minTasks: 0,
              minRating: 0,
              minReviews: 0,
              description: 'New User - Browse tasks'
            },
            basic: {
              minReputation: 10,
              minTasks: 0,
              minRating: 0,
              minReviews: 0,
              description: 'Email + Phone verified'
            },
            verified: {
              minReputation: 25,
              minTasks: 0,
              minRating: 0,
              minReviews: 0,
              description: 'Aadhaar verified'
            },
            trusted: {
              minReputation: 50,
              minTasks: 3,
              minRating: 4.0,
              minReviews: 0,
              description: 'PAN + Bank + 3 tasks + 4.0 rating'
            },
            elite: {
              minReputation: 100,
              minTasks: 10,
              minRating: 4.5,
              minReviews: 0,
              description: 'PAN + Bank + 10 tasks + 4.5 rating + Admin approved'
            }
          },
          verifications: {
            count: verifications.length,
            breakdown: {
              email: {
                status: profile.isEmailVerified ? 'verified' : 'pending',
                points: profile.isEmailVerified ? 3 : 0
              },
              phone: {
                status: profile.phoneVerified ? 'verified' : 'pending',
                points: profile.phoneVerified ? 3 : 0
              },
              aadhaar: {
                status: profile.isAadhaarVerified ? 'verified' : 'pending',
                points: profile.isAadhaarVerified ? 8 : 0
              },
              pan: {
                status: profile.isPANVerified ? 'verified' : 'pending',
                points: profile.isPANVerified ? 6 : 0
              },
              bank: {
                status: profile.isBankVerified ? 'verified' : 'pending',
                points: profile.isBankVerified ? 5 : 0
              }
            },
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

      // Ensure phone verification is set if phone exists
      if (!profile.phoneVerified && profile.phone && profile.phone.length > 0) {
        profile.phoneVerified = true;
        await profile.save();
      }

      // Build verification data from Profile model
      const verifications = [
        ...(profile.isEmailVerified ? [{ type: VerificationType.EMAIL, status: 'verified' }] : []),
        ...(profile.phoneVerified ? [{ type: VerificationType.PHONE, status: 'verified' }] : []),
        ...(profile.isAadhaarVerified ? [{ type: VerificationType.AADHAAR, status: 'verified' }] : []),
        ...(profile.isPANVerified ? [{ type: VerificationType.PAN, status: 'verified' }] : []),
        ...(profile.isBankVerified ? [{ type: VerificationType.BANK, status: 'verified' }] : []),
      ];

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
        verifications: verifications as any,
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

      // Ensure phone verification is set if phone exists
      if (!profile.phoneVerified && profile.phone && profile.phone.length > 0) {
        profile.phoneVerified = true;
        await profile.save();
      }

      // Build verification data from Profile model
      const verifications = [
        ...(profile.isEmailVerified ? [{ type: VerificationType.EMAIL, status: 'verified' }] : []),
        ...(profile.phoneVerified ? [{ type: VerificationType.PHONE, status: 'verified' }] : []),
        ...(profile.isAadhaarVerified ? [{ type: VerificationType.AADHAAR, status: 'verified' }] : []),
        ...(profile.isPANVerified ? [{ type: VerificationType.PAN, status: 'verified' }] : []),
        ...(profile.isBankVerified ? [{ type: VerificationType.BANK, status: 'verified' }] : []),
      ];

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
        verifications: verifications as any,
        totalTasksCompleted,
        totalTasksPosted,
        averageRating,
        totalReviews,
        averageResponseTime: 0,
        cancellationRate: 0
      });

      const profileData = {
        currentBadge: badgeInfo.currentBadge,
        verifications: verifications as any,
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

        (badgeInfo.badgeHistory as any).push({
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

        (badgeInfo.badgeHistory as any).push({
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

        // 🔔 Send approval notification
        try {
          await BadgeNotificationService.sendEliteApprovalNotification(
            userId,
            profile.uid,
            profile.name
          );
        } catch (notifError: any) {
          logger.error('Failed to send elite approval notification', notifError);
        }

        res.json({
          success: true,
          data: { userId, badge: BadgeLevel.ELITE, approved: true }
        });
      } else {
        badgeInfo.eliteRejectionReason = reviewNotes;
        await badgeInfo.save();

        logger.info('Elite badge rejected', { userId, reason: reviewNotes });

        // 🔔 Send rejection notification
        try {
          await BadgeNotificationService.sendEliteRejectionNotification(
            userId,
            profile.uid,
            profile.name,
            reviewNotes
          );
        } catch (notifError: any) {
          logger.error('Failed to send elite rejection notification', notifError);
        }

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

  /**
   * GET /api/v1/user/badge/public/:uid
   * Public endpoint to get any user's badge info (used for displaying badges on profiles, tasks, etc.)
   * Supports both Firebase UID and MongoDB ObjectId lookup
   */
  static async getPublicUserBadge(req: any, res: Response): Promise<void> {
    try {
      const { uid } = req.params;
      
      if (!uid) {
        res.status(400).json({ success: false, error: 'User UID or ID is required' });
        return;
      }

      let profile: any;
      
      // Try to find by uid first (Firebase UID)
      profile = await Profile.findOne({ uid });
      
      // If not found, try to find by MongoDB ObjectId
      if (!profile && uid.match(/^[0-9a-fA-F]{24}$/)) {
        try {
          profile = await Profile.findById(uid);
        } catch (error) {
          // Invalid ObjectId format, skip
        }
      }

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

      // Build verification data from Profile model
      // (Note: We're not using verifications here, just returning public badge info)

      // Return minimal public badge info
      res.json({
        success: true,
        data: {
          userId: profile._id,
          uid: profile.uid,
          currentBadge: badgeInfo.currentBadge,
          name: profile.name,
          badgeUpgradedAt: badgeInfo.badgeUpgradedAt
        }
      });
    } catch (error: any) {
      logger.error('Error getting public user badge:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }
}
