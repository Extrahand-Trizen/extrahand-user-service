import { Response, Request } from 'express';
import { ProfileService } from '../services/ProfileService';
import Profile, { IProfile } from '../models/Profile';
import { AuthenticatedRequest } from '../types';
import logger from '../config/logger';
import { validateEnv } from '../config/env';
import EmailVerificationService from '../services/EmailVerificationService';
import { VerificationBadgeService } from '../services/verificationBadgeService';
import { VerificationType } from '../types/badge';
import { MainAdminNotificationClient } from '../clients/MainAdminNotificationClient';
import {
  ensureDemoVerificationProfile,
  mergeReviewBypassProfile,
} from '../utils/reviewBypass';

type ProfileVisibilityLevel = 'public' | 'registered_users' | 'connections_only' | 'private';

function getPrivateProfileMessage(profile: any): string {
  const visibility = (profile?.profilePrivacy?.profileVisibility || 'registered_users') as ProfileVisibilityLevel;

  if (visibility === 'private') {
    return "This account is private. You can't view this profile.";
  }

  if (visibility === 'connections_only') {
    return 'This profile is private and visible only to connections.';
  }

  return 'This profile is private and visible only to registered users.';
}

function extractTasks(response: any): any[] {
  return response?.data || response?.tasks || response?.items || [];
}

function resolveReviewerDisplayName(review: any): string {
  const direct =
    (typeof review?.reviewerName === 'string' && review.reviewerName.trim()) ||
    (typeof review?.reviewer?.name === 'string' && review.reviewer.name.trim()) ||
    (typeof review?.reviewer?.fullName === 'string' && review.reviewer.fullName.trim()) ||
    (typeof review?.reviewer?.displayName === 'string' && review.reviewer.displayName.trim()) ||
    '';
  if (direct) return direct;

  const first =
    typeof review?.reviewer?.firstName === 'string' ? review.reviewer.firstName.trim() : '';
  const last =
    typeof review?.reviewer?.lastName === 'string' ? review.reviewer.lastName.trim() : '';
  const combined = `${first} ${last}`.trim();
  return combined || '';
}

async function hasWorkedWithTarget(viewerProfile: any, targetProfile: any): Promise<boolean> {
  try {
    const env = validateEnv();

    if (!env.TASK_SERVICE_URL || !env.SERVICE_AUTH_TOKEN) {
      return false;
    }

    if (!viewerProfile?._id || !targetProfile?._id || !viewerProfile?.uid || !targetProfile?.uid) {
      return false;
    }

    const axios = (await import('axios')).default;
    const headers = {
      'X-Service-Auth': env.SERVICE_AUTH_TOKEN,
      'X-Service-Name': 'user-service',
    };

    const [targetAsAssignee, targetAsPoster] = await Promise.allSettled([
      axios.get(`${env.TASK_SERVICE_URL}/api/v1/tasks`, {
        params: {
          assigneeId: targetProfile._id.toString(),
          posterUid: viewerProfile.uid,
          status: 'completed',
          limit: 1,
        },
        headers,
        timeout: 5000,
      }),
      axios.get(`${env.TASK_SERVICE_URL}/api/v1/tasks`, {
        params: {
          assigneeId: viewerProfile._id.toString(),
          posterUid: targetProfile.uid,
          status: 'completed',
          limit: 1,
        },
        headers,
        timeout: 5000,
      }),
    ]);

    if (targetAsAssignee.status === 'fulfilled' && extractTasks(targetAsAssignee.value.data).length > 0) {
      return true;
    }

    if (targetAsPoster.status === 'fulfilled' && extractTasks(targetAsPoster.value.data).length > 0) {
      return true;
    }

    return false;
  } catch (error: any) {
    logger.warn('Failed to evaluate connection-only visibility', {
      error: error.message,
    });
    return false;
  }
}

async function canViewProfile(profile: any, viewerUid?: string): Promise<boolean> {
  const visibility = (profile?.profilePrivacy?.profileVisibility || 'registered_users') as ProfileVisibilityLevel;

  if (visibility === 'private') {
    if (!viewerUid) {
      return false;
    }
    return viewerUid === profile.uid;
  }

  if (visibility === 'public') {
    return true;
  }

  if (!viewerUid) {
    return false;
  }

  if (viewerUid === profile.uid) {
    return true;
  }

  if (visibility === 'registered_users') {
    return true;
  }

  const viewerProfile = await ProfileService.getProfileByUid(viewerUid);
  return hasWorkedWithTarget(viewerProfile, profile);
}

export class ProfileController {
  /** 
   * GET /api/v1/profiles/me
   */
  static async getMyProfile(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const uid = req.user!.uid;
      let profile = await ProfileService.getMyProfile(uid);
      profile = await ensureDemoVerificationProfile(profile);

      // Always fetch real-time stats from task-service (not from stored profile)
      let realTimeStats: {
        totalTasks: number | undefined;
        completedTasks: number | undefined;
        postedTasks: number | undefined;
        totalReviews: number | undefined;
        rating: number | undefined;
        ratingBreakdowns: any;
      } = {
        totalTasks: undefined,
        completedTasks: undefined,
        postedTasks: undefined,
        totalReviews: undefined,
        rating: undefined,
        ratingBreakdowns: undefined
      };
      let workHistory: any[] = [];

      try {
        const env = validateEnv();
        if (env.TASK_SERVICE_URL && env.SERVICE_AUTH_TOKEN && profile._id) {
          const { statsService } = await import('../services/StatsService');
          
          // Fetch all stats real-time
          const stats = await statsService.calculateAllStats(profile._id.toString(), uid);
          
          realTimeStats = {
            totalTasks: stats.totalTasks,
            completedTasks: stats.completedTasks,
            postedTasks: stats.postedTasks,
            totalReviews: stats.totalReviews,
            rating: stats.avgRating > 0 ? Math.round(stats.avgRating * 10) / 10 : undefined,
            ratingBreakdowns: stats.ratingBreakdowns
          };

          logger.info('✅ Fetched real-time stats for my profile', {
            uid,
            stats: realTimeStats
          });

          // Fetch work history only if user has completed tasks
          if (stats.completedTasks && stats.completedTasks > 0) {
            const axios = (await import('axios')).default;
            const tasksResponse = await axios.get(
              `${env.TASK_SERVICE_URL}/api/v1/tasks`,
              {
                params: {
                  assigneeId: profile._id.toString(),
                  status: 'completed',
                  limit: 10,
                  sort: '-completedAt'
                },
                headers: {
                  'X-Service-Auth': env.SERVICE_AUTH_TOKEN,
                  'X-Service-Name': 'user-service'
                },
                timeout: 5000
              }
            );

            const tasks = tasksResponse.data?.tasks || tasksResponse.data?.data || [];
            workHistory = tasks
              .filter((task: any) => task.completedAt && task.status === 'completed')
              .map((task: any) => ({
                _id: task._id,
                title: task.title,
                category: task.category,
                completedAt: task.completedAt,
                budget: task.budget?.amount || 0
              }));

            logger.info('✅ Fetched work history for my profile', {
              uid,
              workHistoryCount: workHistory.length
            });
          } else {
            logger.info('⏭️ Skipped fetching work history (no completed tasks)', {
              uid,
              completedTasks: stats.completedTasks || 0
            });
          }
        }
      } catch (error: any) {
        logger.warn('Failed to fetch real-time stats (non-critical)', {
          uid,
          error: error.message
        });
      }

      // Ensure verification badge/tier are always present (recompute if missing so trust level reflects)
      let verificationBadge = profile.verificationBadge ?? 'none';
      let verificationTier = profile.verificationTier ?? 0;
      if (profile.verificationBadge == null || profile.verificationTier == null) {
        try {
          const badgeResult = await VerificationBadgeService.calculateVerificationBadge(uid);
          verificationBadge = badgeResult.badge;
          verificationTier = badgeResult.tier;
          // Persist so future requests have it
          await VerificationBadgeService.updateProfileBadge(uid);
        } catch (badgeErr: any) {
          logger.warn('Could not compute verification badge for profile response', { uid, err: badgeErr?.message });
        }
      }

      // Ensure savedAddresses are properly serialized
      const serializedProfile = {
        id: profile.uid,
        ...profile,
        // Override with real-time stats
        totalTasks: realTimeStats.totalTasks,
        completedTasks: realTimeStats.completedTasks,
        postedTasks: realTimeStats.postedTasks,
        totalReviews: realTimeStats.totalReviews,
        rating: realTimeStats.rating,
        ratingBreakdowns: realTimeStats.ratingBreakdowns,
        isAadhaarVerified: profile.isAadhaarVerified || false,
        aadhaarVerifiedAt: profile.aadhaarVerifiedAt || null,
        isPANVerified: profile.isPANVerified || false,
        panVerifiedAt: profile.panVerifiedAt || null,
        verificationBadge,
        verificationTier,
        savedAddresses: profile.savedAddresses ? profile.savedAddresses.map((addr: any) => ({
          _id: addr._id?.toString() || addr._id,
          label: addr.label,
          address: addr.address,
          coordinates: addr.coordinates,
          city: addr.city,
          state: addr.state,
          country: addr.country,
          addressDetails: addr.addressDetails,
          name: addr.name,
          phone: addr.phone,
          isDefault: addr.isDefault,
          createdAt: addr.createdAt,
        })) : [],
        workHistory: workHistory, // Include work history
      };

      const responseBody =
        mergeReviewBypassProfile(serializedProfile) ?? serializedProfile;

      res.json(responseBody);
    } catch (error: any) {
      console.error('❌ [ProfileController.getMyProfile] Error:', error);
      res.status(error.statusCode || 500).json({
        success: false,
        error: error.message || 'Failed to fetch profile',
      });
    }
  }

  /**
   * GET /api/v1/profiles/search
   */
  static async searchProfiles(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { q, limit = 10 } = req.query;
    const currentUserId = req.user?.uid;

    const profiles = await ProfileService.searchProfiles(
      q as string,
      parseInt(limit as string),
      currentUserId
    );

    res.json({
      success: true,
      users: profiles.map(profile => ({
        _id: profile._id,
        profileId: profile._id,
        uid: profile.uid,
        name: profile.name,
        email: profile.email,
        phone: profile.phone,
        roles: profile.roles,
        userType: profile.userType,
        skills: profile.skills,
        rating: profile.rating,
        totalReviews: profile.totalReviews,
        isVerified: profile.isVerified,
        isAadhaarVerified: profile.isAadhaarVerified,
        location: profile.location
      }))
    });
  }

  /**
   * GET /api/v1/profiles/internal/certificates/queue
   * Service-to-service certificate review queue for admin-service.
   */
  static async getInternalCertificateQueue(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const {
        uid,
        q,
        status,
        city,
        page = '1',
        limit = '20',
        onlyOwnReviewedDecisions,
        reviewerUserId,
        reviewerIdentities,
      } = req.query;
      const statusTrimmed = (status as string | undefined)?.trim();
      const normalizedStatus =
        statusTrimmed === 'pending' ||
        statusTrimmed === 'verified' ||
        statusTrimmed === 'rejected'
          ? statusTrimmed
          : undefined;
      const onlyOwnReviewed =
        String(onlyOwnReviewedDecisions || '').toLowerCase() === 'true';
      const normalizedReviewerUserId =
        (reviewerUserId as string | undefined)?.trim() || undefined;
      const normalizedReviewerIdentities = ((reviewerIdentities as string | undefined) || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);

      if (statusTrimmed && !normalizedStatus) {
        res.status(400).json({
          success: false,
          error: 'Invalid status. Allowed: pending, verified, rejected',
        });
        return;
      }

      const queue = await ProfileService.getCertificateReviewQueue({
        uid: uid as string | undefined,
        q: q as string | undefined,
        city: city as string | undefined,
        status: normalizedStatus,
        page: parseInt(page as string, 10) || 1,
        limit: parseInt(limit as string, 10) || 20,
        onlyOwnReviewedDecisions: onlyOwnReviewed,
        reviewerUserId: normalizedReviewerUserId,
        reviewerIdentities:
          normalizedReviewerIdentities.length > 0
            ? normalizedReviewerIdentities
            : undefined,
      });

      res.json({
        success: true,
        data: {
          items: queue.items,
          pagination: queue.pagination,
        },
      });
    } catch (error: any) {
      logger.error('Failed to fetch internal certificate queue', {
        error: error.message,
      });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch certificate queue',
        message: error.message,
      });
    }
  }

  /**
   * GET /api/v1/profiles/internal/stats/taskers/aadhaar-verified
   * Service-to-service stats for admin dashboard.
   */
  static async getInternalTaskerAadhaarVerifiedCount(
    _req: AuthenticatedRequest,
    res: Response
  ): Promise<void> {
    try {
      const count = await ProfileService.getTaskerAadhaarVerifiedCount();
      res.json({
        success: true,
        data: {
          taskersAadhaarVerified: count,
        },
      });
    } catch (error: any) {
      logger.error('Failed to fetch tasker Aadhaar verified count', {
        error: error.message,
      });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch tasker Aadhaar verified count',
        message: error.message,
      });
    }
  }

  /**
   * GET /api/v1/profiles/internal/stats/taskers/category-counts
   * Service-to-service helper counts grouped by category from skills.
   */
  static async getInternalTaskerCategoryCounts(
    _req: AuthenticatedRequest,
    res: Response
  ): Promise<void> {
    try {
      const categoryCounts = await ProfileService.getTaskerCategoryCountsForAdmin();
      res.json({
        success: true,
        data: {
          categories: categoryCounts.categories,
          summary: categoryCounts.summary,
        },
      });
    } catch (error: any) {
      logger.error('Failed to fetch tasker category counts', {
        error: error.message,
      });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch tasker category counts',
        message: error.message,
      });
    }
  }

  /**
   * GET /api/v1/profiles/internal/certificates/analytics
   * Aggregated certificate review metrics for admin-service (service auth).
   */
  static async getInternalCertificateAnalytics(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { from, to } = req.query;
      const defaultTo = new Date();
      const defaultFrom = new Date(defaultTo.getTime() - 30 * 24 * 60 * 60 * 1000);

      const fromDate = from ? new Date(String(from)) : defaultFrom;
      const toDate = to ? new Date(String(to)) : defaultTo;

      const analytics = await ProfileService.getCertificateReviewAnalytics({
        from: fromDate,
        to: toDate,
      });

      res.json({
        success: true,
        data: analytics,
      });
    } catch (error: any) {
      logger.error('Failed to fetch certificate analytics', {
        error: error.message,
      });
      const status = error.statusCode || 500;
      res.status(status).json({
        success: false,
        error: 'Failed to fetch certificate analytics',
        message: error.message,
      });
    }
  }

  /**
   * POST /api/v1/profiles/internal/match-users
   * Service-to-service endpoint for finding matching users
   * Called by task-service when a task is created
   * 
   * Request body:
   * {
   *   "type": "skill" | "keywords",
   *   "criteria": {
   *     "category": string (for skill matching)
   *     OR
   *     "keywords": string[] (for keyword matching)
   *   }
   * }
   * 
   * Response:
   * {
   *   "success": true,
   *   "userIds": string[],
   *   "count": number
   * }
   */
  static async matchUsers(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { type, criteria } = req.body;

      if (!type || !criteria) {
        res.status(400).json({
          success: false,
          error: 'Missing type or criteria in request body'
        });
        return;
      }

      let userIds: string[] = [];

      if (type === 'skill') {
        if (!criteria.category) {
          res.status(400).json({
            success: false,
            error: 'Missing category in criteria for skill matching'
          });
          return;
        }
        userIds = await ProfileService.findUsersBySkillCategory(criteria.category);
      } else if (type === 'keywords') {
        if (!criteria.keywords || !Array.isArray(criteria.keywords)) {
          res.status(400).json({
            success: false,
            error: 'Missing or invalid keywords array in criteria for keyword matching'
          });
          return;
        }
        userIds = await ProfileService.findUsersByAnyKeyword(criteria.keywords);
      } else if (type === 'categories') {
        if (!criteria.categorySlugs || !Array.isArray(criteria.categorySlugs)) {
          res.status(400).json({
            success: false,
            error: 'Missing or invalid categorySlugs array in criteria for category matching'
          });
          return;
        }
        userIds = await ProfileService.findUsersByAnyCategory(criteria.categorySlugs);
      } else {
        res.status(400).json({
          success: false,
          error: `Invalid matching type: ${type}. Must be 'skill', 'keywords', or 'categories'`
        });
        return;
      }

      logger.info('ProfileController.matchUsers: Request processed', {
        type,
        criteriaKeys: Object.keys(criteria),
        matchedCount: userIds.length
      });

      res.json({
        success: true,
        userIds,
        count: userIds.length
      });
    } catch (error: any) {
      logger.error('ProfileController.matchUsers: Error', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Internal server error'
      });
    }
  }

  /**
   * GET /api/v1/profiles/public/:uid
   */
  static async getPublicProfile(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { uid } = req.params;
      const profile = await ProfileService.getProfileByUid(uid);
      const viewerUid = req.user?.uid;

      if (!(await canViewProfile(profile, viewerUid))) {
        res.status(403).json({
          success: false,
          error: 'Profile is private',
          message: getPrivateProfileMessage(profile),
          code: 'PROFILE_PRIVATE'
        });
        return;
      }

      // Always fetch real-time stats from task-service (not from stored profile)
      let realTimeStats: {
        totalTasks: number | undefined;
        completedTasks: number | undefined;
        postedTasks: number | undefined;
        totalReviews: number | undefined;
        rating: number | undefined;
        ratingBreakdowns: any;
      } = {
        totalTasks: undefined,
        completedTasks: undefined,
        postedTasks: undefined,
        totalReviews: undefined,
        rating: undefined,
        ratingBreakdowns: undefined
      };
      let reviews: any[] = [];
      let workHistory: any[] = [];

      try {
        const env = validateEnv();
        if (env.TASK_SERVICE_URL && env.SERVICE_AUTH_TOKEN && profile._id) {
          const { statsService } = await import('../services/StatsService');
          const stats = await statsService.calculateAllStats(profile._id.toString(), profile.uid);
          
          realTimeStats = {
            totalTasks: stats.totalTasks,
            completedTasks: stats.completedTasks,
            postedTasks: stats.postedTasks,
            totalReviews: stats.totalReviews,
            rating: stats.avgRating > 0 ? Math.round(stats.avgRating * 10) / 10 : undefined,
            ratingBreakdowns: stats.ratingBreakdowns
          };
          
          logger.info('✅ Fetched real-time rating/reviews for public profile', {
            uid,
            stats: realTimeStats
          });

          const axios = (await import('axios')).default;

          if (stats.totalReviews && stats.totalReviews > 0) {
            try {
              const reviewsResponse = await axios.get(
                `${env.TASK_SERVICE_URL}/api/v1/reviews/user/${profile._id.toString()}`,
                {
                  headers: {
                    'X-Service-Auth': env.SERVICE_AUTH_TOKEN,
                    'X-User-Id': profile.uid,
                    'X-Service-Name': 'user-service'
                  },
                  timeout: 5000
                }
              );

              reviews = reviewsResponse.data?.data || reviewsResponse.data?.reviews || [];
            } catch (error: any) {
              logger.warn('Failed to fetch reviews for public profile', {
                uid,
                error: error.message
              });
            }
          }

          if (stats.completedTasks && stats.completedTasks > 0) {
            try {
              const tasksResponse = await axios.get(
                `${env.TASK_SERVICE_URL}/api/v1/tasks`,
                {
                  params: {
                    assigneeId: profile._id.toString(),
                    status: 'completed',
                    limit: 10,
                    sort: '-completedAt'
                  },
                  headers: {
                    'X-Service-Auth': env.SERVICE_AUTH_TOKEN,
                    'X-Service-Name': 'user-service'
                  },
                  timeout: 5000
                }
              );

              const tasks = tasksResponse.data?.tasks || tasksResponse.data?.data || [];
              workHistory = tasks
                .filter((task: any) => task.completedAt && task.status === 'completed')
                .map((task: any) => ({
                  _id: task._id,
                  title: task.title,
                  category: task.category,
                  completedAt: task.completedAt,
                  budget: task.budget?.amount || 0
                }));
            } catch (error: any) {
              logger.warn('Failed to fetch work history for public profile', {
                uid,
                error: error.message
              });
            }
          }
        }
      } catch (error: any) {
        logger.warn('Failed to fetch real-time stats for public profile', {
          uid,
          error: error.message
        });
      }

      const aboutText = (profile as any).bio || (profile.business as any)?.description || null;

      const publicProfile = {
        _id: profile._id,
        uid: profile.uid,
        name: profile.name,
        profession: profile.profession,
        bio: aboutText,
        roles: profile.roles,
        userType: profile.userType,
        rating: realTimeStats.rating,
        totalReviews: realTimeStats.totalReviews,
        skills: profile.skills,
        portfolio: Array.isArray((profile as any).portfolio) ? (profile as any).portfolio : [],
        photoURL: profile.photoURL || null,
        business: profile.business,
        location: profile.location ? {
          city: profile.location.addressDetails?.city,
          state: profile.location.addressDetails?.state,
          country: profile.location.addressDetails?.country
        } : null,
        isVerified: profile.isVerified,
        isAadhaarVerified: profile.isAadhaarVerified || false,
        aadhaarVerifiedAt: profile.aadhaarVerifiedAt || null,
        isEmailVerified: profile.isEmailVerified || false,
        emailVerifiedAt: profile.emailVerifiedAt || null,
        isPANVerified: profile.isPANVerified || false,
        isPanVerified: profile.isPANVerified || false,
        panVerifiedAt: profile.panVerifiedAt || null,
        maskedPan: profile.maskedPan || null,
        isBankVerified: profile.isBankVerified || false,
        bankVerifiedAt: profile.bankVerifiedAt || null,
        totalTasks: realTimeStats.totalTasks,
        completedTasks: realTimeStats.completedTasks,
        postedTasks: realTimeStats.postedTasks,
        earnedAmount: profile.earnedAmount,
        isActive: profile.isActive,
        createdAt: profile.createdAt,
        reviews: reviews
          .filter((review: any) => Number(review?.rating) > 0)
          .map((review: any, index: number) => ({
            _id: review._id || review.id || `${review.taskId || review.reviewerId || 'review'}-${index}`,
            taskId: review.taskId,
            taskTitle: review.taskTitle || review.title || 'Task',
            reviewerId: review.reviewerId || review.reviewerUid || review.reviewer?.id || 'unknown',
            reviewerName: resolveReviewerDisplayName(review),
            reviewerPhoto: review.reviewerPhoto || review.reviewer?.photoURL || review.reviewer?.photo,
            rating: Number(review.rating) || 0,
            comment: typeof review.comment === 'string' ? review.comment : '',
            createdAt: review.createdAt || review.updatedAt || new Date().toISOString(),
          }))
          .filter((review: any) => review.rating > 0),
        workHistory: workHistory.filter((item: any) => item.title && item.title.trim() !== '')
      };

      res.json({
        success: true,
        profile: publicProfile
      });
    } catch (error: any) {
      logger.error('Error fetching public profile', {
        error: error.message
      });
      res.status(error.statusCode || 500).json({
        success: false,
        error: error.message || 'Failed to fetch profile'
      });
    }
  }

  /**
   * GET /api/v1/profiles/:uid
   */
  static async getProfile(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { uid } = req.params;
      const profile = await ProfileService.getProfileByUid(uid);
      const viewerUid = req.user?.uid;

      if (!(await canViewProfile(profile, viewerUid))) {
        res.status(403).json({
          success: false,
          error: 'Profile is private',
          message: getPrivateProfileMessage(profile),
          code: 'PROFILE_PRIVATE'
        });
        return;
      }

      // Always fetch real-time stats from task-service (not from stored profile)
      let realTimeStats: {
        totalTasks: number | undefined;
        completedTasks: number | undefined;
        postedTasks: number | undefined;
        totalReviews: number | undefined;
        rating: number | undefined;
        ratingBreakdowns: any;
      } = {
        totalTasks: undefined,
        completedTasks: undefined,
        postedTasks: undefined,
        totalReviews: undefined,
        rating: undefined,
        ratingBreakdowns: undefined
      };
      let reviews: any[] = [];
      let workHistory: any[] = [];

      try {
        const env = validateEnv();
        if (env.TASK_SERVICE_URL && env.SERVICE_AUTH_TOKEN && profile._id) {
          const { statsService } = await import('../services/StatsService');
          
          // Fetch all stats real-time
          const stats = await statsService.calculateAllStats(profile._id.toString(), profile.uid);
          
          realTimeStats = {
            totalTasks: stats.totalTasks,
            completedTasks: stats.completedTasks,
            postedTasks: stats.postedTasks,
            totalReviews: stats.totalReviews,
            rating: stats.avgRating > 0 ? Math.round(stats.avgRating * 10) / 10 : undefined,
            ratingBreakdowns: stats.ratingBreakdowns
          };

          logger.info('✅ Fetched real-time stats for profile', {
            uid,
            stats: realTimeStats
          });

          const axios = (await import('axios')).default;

          // Fetch reviews only if user has reviews
          if (stats.totalReviews && stats.totalReviews > 0) {
            try {
              const reviewsResponse = await axios.get(
                `${env.TASK_SERVICE_URL}/api/v1/reviews/user/${profile._id.toString()}`,
                {
                  headers: {
                    'X-Service-Auth': env.SERVICE_AUTH_TOKEN,
                    'X-User-Id': profile.uid,
                    'X-Service-Name': 'user-service'
                  },
                  timeout: 5000
                }
              );

              reviews = reviewsResponse.data?.data || reviewsResponse.data?.reviews || [];
            } catch (error: any) {
              logger.warn('Failed to fetch reviews for profile', {
                uid,
                error: error.message
              });
            }
          }

          // Fetch work history only if user has completed tasks
          if (stats.completedTasks && stats.completedTasks > 0) {
            try {
              const tasksResponse = await axios.get(
                `${env.TASK_SERVICE_URL}/api/v1/tasks`,
                {
                  params: {
                    assigneeId: profile._id.toString(),
                    status: 'completed',
                    limit: 10,
                    sort: '-completedAt'
                  },
                  headers: {
                    'X-Service-Auth': env.SERVICE_AUTH_TOKEN,
                    'X-Service-Name': 'user-service'
                  },
                  timeout: 5000
                }
              );

              const tasks = tasksResponse.data?.tasks || tasksResponse.data?.data || [];
              workHistory = tasks
                .filter((task: any) => task.completedAt && task.status === 'completed')
                .map((task: any) => ({
                  _id: task._id,
                  title: task.title,
                  category: task.category,
                  completedAt: task.completedAt,
                  budget: task.budget?.amount || 0
                }));
            } catch (error: any) {
              logger.warn('Failed to fetch work history for profile', {
                uid,
                error: error.message
              });
            }
          }

          logger.info('✅ Fetched reviews and work history for profile', {
            uid,
            reviewsCount: reviews.length,
            workHistoryCount: workHistory.length
          });
        }
      } catch (error: any) {
        logger.warn('Failed to fetch real-time stats for profile (non-critical)', {
          uid,
          error: error.message
        });
      }

      const aboutText = (profile as any).bio || (profile.business as any)?.description || null;

      const publicProfile = {
        _id: profile._id,
        uid: profile.uid,
        name: profile.name,
        profession: profile.profession,
        email: profile.email,
        phone: profile.phone,
        bio: aboutText,
        roles: profile.roles,
        userType: profile.userType,
        rating: realTimeStats.rating,
        totalReviews: realTimeStats.totalReviews,
        skills: profile.skills,
        portfolio: Array.isArray((profile as any).portfolio) ? (profile as any).portfolio : [],
        photoURL: profile.photoURL || null,
        location: profile.location ? {
          city: profile.location.addressDetails?.city,
          state: profile.location.addressDetails?.state,
          country: profile.location.addressDetails?.country
        } : null,
        isVerified: profile.isVerified,
        isAadhaarVerified: profile.isAadhaarVerified || false,
        aadhaarVerifiedAt: profile.aadhaarVerifiedAt || null,
        isEmailVerified: profile.isEmailVerified || false,
        emailVerifiedAt: profile.emailVerifiedAt || null,
        isPhoneVerified: profile.phoneVerified === true || !!profile.phone,
        phoneVerified: profile.phoneVerified === true || !!profile.phone,
        phoneVerifiedAt: null,
        isPANVerified: profile.isPANVerified || false,
        isPanVerified: profile.isPANVerified || false,
        panVerifiedAt: profile.panVerifiedAt || null,
        maskedPan: profile.maskedPan || null,
        isBankVerified: profile.isBankVerified || false,
        bankVerifiedAt: profile.bankVerifiedAt || null,
        totalTasks: realTimeStats.totalTasks,
        completedTasks: realTimeStats.completedTasks,
        postedTasks: realTimeStats.postedTasks,
        earnedAmount: profile.earnedAmount,
        business: profile.business,
        isActive: profile.isActive,
        createdAt: profile.createdAt,
        // Include reviews in response with safe fallbacks so valid ratings are not dropped.
        reviews: reviews
          .filter((review: any) => Number(review?.rating) > 0)
          .map((review: any, index: number) => ({
            _id: review._id || review.id || `${review.taskId || review.reviewerId || 'review'}-${index}`,
            taskId: review.taskId,
            taskTitle: review.taskTitle || review.title || 'Task',
            reviewerId: review.reviewerId || review.reviewerUid || review.reviewer?.id || 'unknown',
            reviewerName: resolveReviewerDisplayName(review),
            reviewerPhoto: review.reviewerPhoto || review.reviewer?.photoURL || review.reviewer?.photo,
            rating: Number(review.rating) || 0,
            comment: typeof review.comment === 'string' ? review.comment : '',
            createdAt: review.createdAt || review.updatedAt || new Date().toISOString(),
          }))
          .filter((review: any) => review.rating > 0),
        // Include work history in response - filter out invalid entries
        workHistory: workHistory.filter((item: any) => item.title && item.title.trim() !== '')
      };

      res.json({
        success: true,
        profile: publicProfile
      });
    } catch (error: any) {
      logger.error('Error fetching profile', {
        error: error.message
      });
      res.status(error.statusCode || 500).json({
        success: false,
        error: error.message || 'Failed to fetch profile'
      });
    }
  }

  /**
   * GET /api/v1/profiles/public/id/:profileId
   * Get public profile by MongoDB ObjectId
   * Used when frontend passes MongoDB ID instead of Firebase UID
   */
  static async getPublicProfileById(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { profileId } = req.params;
      const profile = await ProfileService.getPublicProfileById(profileId);
      const viewerUid = req.user?.uid;

      if (!(await canViewProfile(profile, viewerUid))) {
        res.status(403).json({
          success: false,
          error: 'Profile is private',
          message: getPrivateProfileMessage(profile),
          code: 'PROFILE_PRIVATE'
        });
        return;
      }

      // Always fetch real-time stats from task-service (not from stored profile)
      let realTimeStats: {
        totalTasks: number | undefined;
        completedTasks: number | undefined;
        postedTasks: number | undefined;
        totalReviews: number | undefined;
        rating: number | undefined;
        ratingBreakdowns: any;
      } = {
        totalTasks: undefined,
        completedTasks: undefined,
        postedTasks: undefined,
        totalReviews: undefined,
        rating: undefined,
        ratingBreakdowns: undefined
      };
      let reviews: any[] = [];
      let workHistory: any[] = [];

      try {
        const env = validateEnv();
        if (env.TASK_SERVICE_URL && env.SERVICE_AUTH_TOKEN && profile._id) {
          const { statsService } = await import('../services/StatsService');
          
          // Fetch all stats real-time
          const stats = await statsService.calculateAllStats(profile._id.toString(), profile.uid);
          
          realTimeStats = {
            totalTasks: stats.totalTasks,
            completedTasks: stats.completedTasks,
            postedTasks: stats.postedTasks,
            totalReviews: stats.totalReviews,
            rating: stats.avgRating > 0 ? Math.round(stats.avgRating * 10) / 10 : undefined,
            ratingBreakdowns: stats.ratingBreakdowns
          };

          logger.info('✅ Fetched real-time stats for public profile', {
            profileId,
            uid: profile.uid,
            stats: realTimeStats
          });

          const axios = (await import('axios')).default;

          // Fetch reviews only if user has reviews
          if (stats.totalReviews && stats.totalReviews > 0) {
            try {
              const reviewsResponse = await axios.get(
                `${env.TASK_SERVICE_URL}/api/v1/reviews/user/${profile._id.toString()}`,
                {
                  headers: {
                    'X-Service-Auth': env.SERVICE_AUTH_TOKEN,
                    'X-User-Id': profile.uid,
                    'X-Service-Name': 'user-service'
                  },
                  timeout: 5000
                }
              );

              reviews = reviewsResponse.data?.data || reviewsResponse.data?.reviews || [];
            } catch (error: any) {
              logger.warn('Failed to fetch reviews for public profile', {
                profileId,
                error: error.message
              });
            }
          }

          // Fetch work history only if user has completed tasks
          if (stats.completedTasks && stats.completedTasks > 0) {
            try {
              const tasksResponse = await axios.get(
                `${env.TASK_SERVICE_URL}/api/v1/tasks`,
                {
                  params: {
                    assigneeId: profile._id.toString(),
                    status: 'completed',
                    limit: 10,
                    sort: '-completedAt'
                  },
                  headers: {
                    'X-Service-Auth': env.SERVICE_AUTH_TOKEN,
                    'X-Service-Name': 'user-service'
                  },
                  timeout: 5000
                }
              );

              const tasks = tasksResponse.data?.tasks || tasksResponse.data?.data || [];
              workHistory = tasks
                .filter((task: any) => task.completedAt && task.status === 'completed')
                .map((task: any) => ({
                  _id: task._id,
                  title: task.title,
                  category: task.category,
                  completedAt: task.completedAt,
                  budget: task.budget?.amount || 0
                }));
            } catch (error: any) {
              logger.warn('Failed to fetch work history for public profile', {
                profileId,
                error: error.message
              });
            }
          }

          logger.info('✅ Fetched reviews and work history for public profile', {
            profileId,
            uid: profile.uid,
            reviewsCount: reviews.length,
            workHistoryCount: workHistory.length,
            hadActivity: { completedTasks: stats.completedTasks, totalReviews: stats.totalReviews }
          });
        }
      } catch (error: any) {
        logger.warn('Failed to fetch real-time stats for public profile (non-critical)', {
          profileId,
          uid: profile.uid,
          error: error.message
        });
      }

      // Return the same structure as public profile section
      const publicProfile = {
        _id: profile._id,
        uid: profile.uid,
        name: profile.name,
        profession: profile.profession,
        email: profile.email,
        phone: profile.phone,
        roles: profile.roles,
        userType: profile.userType,
        rating: realTimeStats.rating,
        totalReviews: realTimeStats.totalReviews,
        skills: profile.skills,
        portfolio: Array.isArray((profile as any).portfolio) ? (profile as any).portfolio : [],
        photoURL: profile.photoURL || null,
        location: profile.location ? {
          city: profile.location.addressDetails?.city,
          state: profile.location.addressDetails?.state,
          country: profile.location.addressDetails?.country
        } : null,
        isVerified: profile.isVerified,
        isAadhaarVerified: profile.isAadhaarVerified || false,
        aadhaarVerifiedAt: profile.aadhaarVerifiedAt || null,
        isEmailVerified: profile.isEmailVerified || false,
        emailVerifiedAt: profile.emailVerifiedAt || null,
        isPhoneVerified: profile.phoneVerified === true || !!profile.phone,
        phoneVerified: profile.phoneVerified === true || !!profile.phone,
        phoneVerifiedAt: null,
        isPANVerified: profile.isPANVerified || false,
        isPanVerified: profile.isPANVerified || false,
        panVerifiedAt: profile.panVerifiedAt || null,
        maskedPan: profile.maskedPan || null,
        isBankVerified: profile.isBankVerified || false,
        bankVerifiedAt: profile.bankVerifiedAt || null,
        totalTasks: realTimeStats.totalTasks,
        completedTasks: realTimeStats.completedTasks,
        postedTasks: realTimeStats.postedTasks,
        earnedAmount: profile.earnedAmount,
        business: profile.business,
        isActive: profile.isActive,
        createdAt: profile.createdAt,
        // Include reviews in response with safe fallbacks so valid ratings are not dropped.
        reviews: reviews
          .filter((review: any) => Number(review?.rating) > 0)
          .map((review: any, index: number) => ({
            _id: review._id || review.id || `${review.taskId || review.reviewerId || 'review'}-${index}`,
            taskId: review.taskId,
            taskTitle: review.taskTitle || review.title || 'Task',
            reviewerId: review.reviewerId || review.reviewerUid || review.reviewer?.id || 'unknown',
            reviewerName: resolveReviewerDisplayName(review),
            reviewerPhoto: review.reviewerPhoto || review.reviewer?.photoURL || review.reviewer?.photo,
            rating: Number(review.rating) || 0,
            comment: typeof review.comment === 'string' ? review.comment : '',
            createdAt: review.createdAt || review.updatedAt || new Date().toISOString(),
          }))
          .filter((review: any) => review.rating > 0),
        // Include work history in response - filter out invalid entries
        workHistory: workHistory.filter((item: any) => item.title && item.title.trim() !== '')
      };

      res.json({
        success: true,
        profile: publicProfile
      });
    } catch (error: any) {
      logger.error('Error in getPublicProfileById', {
        error: error.message,
        stack: error.stack,
      });
      res.status(error.statusCode || 404).json({
        success: false,
        error: error.message || 'Profile not found',
      });
    }
  }

  /**
   * GET /api/v1/profiles/by-id/:profileId
   * Get profile by ObjectId (for enrichment - minimal fields)
   */
  static async getProfileById(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { profileId } = req.params;

      if (!profileId) {
        res.status(400).json({
          success: false,
          error: 'Profile ID is required',
        });
        return;
      }

      const profile = await ProfileService.getProfileById(profileId);

      if (!profile) {
        res.status(404).json({
          success: false,
          error: 'Profile not found',
        });
        return;
      }

      res.json({
        success: true,
        profile,
      });
    } catch (error: any) {
      logger.error('Error in getProfileById', {
        error: error.message,
        stack: error.stack,
      });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch profile',
      });
    }
  }

  /**
   * POST /api/v1/profiles/batch
   * Get multiple profiles by ObjectIds (for enrichment - minimal fields)
   * Body: { profileIds: ["ObjectId1", "ObjectId2", ...] }
   */
  static async getProfilesBatch(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { profileIds } = req.body;

      if (!Array.isArray(profileIds) || profileIds.length === 0) {
        res.status(400).json({
          success: false,
          error: 'profileIds array is required',
        });
        return;
      }

      // Limit batch size to prevent abuse
      const limitedIds = profileIds.slice(0, 100);

      const profileMap = await ProfileService.getProfilesBatch(limitedIds);

      // Convert Map to array for JSON response
      const profiles = Array.from(profileMap.values());

      res.json({
        success: true,
        profiles,
        count: profiles.length,
      });
    } catch (error: any) {
      logger.error('Error in getProfilesBatch', {
        error: error.message,
        stack: error.stack,
      });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch profiles',
      });
    }
  }

  /**
   * POST /api/v1/profiles/batch/uids
   * Get multiple profiles by Firebase UIDs (for enrichment - minimal fields)
   * Body: { uids: ["uid1", "uid2", ...] }
   */
  static async getProfilesBatchByUids(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { uids } = req.body;

      if (!Array.isArray(uids) || uids.length === 0) {
        res.status(400).json({
          success: false,
          error: 'uids array is required',
        });
        return;
      }

      // Limit batch size
      const limitedUids = uids.slice(0, 100);

      const profileMap = await ProfileService.getProfilesBatchByUids(limitedUids);

      // Convert Map to array
      const profiles = Array.from(profileMap.values());

      res.json({
        success: true,
        profiles,
        count: profiles.length,
      });
    } catch (error: any) {
      logger.error('Error in getProfilesBatchByUids', {
        error: error.message,
        stack: error.stack,
      });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch profiles',
      });
    }
  }

  /**
   * POST /api/v1/profiles
   */
  static async createProfile(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user || !req.user.uid) {
      res.status(401).json({
        error: 'Authentication required',
        message: 'Please log in to continue'
      });
      return;
    }

    const uid = req.user.uid;
    const profileData: Partial<IProfile> = req.body;

    const savedProfile = await ProfileService.upsertProfile(uid, profileData);

    res.json({
      id: uid,
      ...savedProfile,
      message: 'Profile created successfully'
    });
  }

  /**
   * PUT /api/v1/profiles/me
   */
  static async updateProfile(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user || !req.user.uid) {
      res.status(401).json({
        error: 'Authentication required',
        message: 'Please log in to continue'
      });
      return;
    }

    const uid = req.user.uid;
    const profileData: Partial<IProfile> = req.body;

    logger.debug('[ProfileController.updateProfile] Request data', {
      uid,
      hasSavedAddresses: !!profileData.savedAddresses,
      savedAddressesCount: Array.isArray(profileData.savedAddresses) ? profileData.savedAddresses.length : 0,
      savedAddressesPreview: Array.isArray(profileData.savedAddresses) && profileData.savedAddresses.length > 0
        ? {
          firstAddress: {
            label: profileData.savedAddresses[0].label,
            address: profileData.savedAddresses[0].address?.substring(0, 50),
            hasCoordinates: Array.isArray(profileData.savedAddresses[0].coordinates),
            coordinates: profileData.savedAddresses[0].coordinates
          }
        }
        : null
    });

    try {
      const updatedProfile = await ProfileService.updateProfile(uid, profileData);

      res.json({
        success: true,
        id: uid,
        ...updatedProfile,
        message: 'Profile updated successfully'
      });
    } catch (error: any) {
      logger.error('[ProfileController.updateProfile] Error', {
        message: error.message,
        name: error.name,
        code: error.code,
        errors: error.errors,
        stack: error.stack?.substring(0, 500)
      });

      // Check for Mongoose validation errors
      if (error.name === 'ValidationError') {
        const validationErrors = Object.keys(error.errors || {}).map(key => ({
          field: key,
          message: error.errors[key].message
        }));

        res.status(400).json({
          success: false,
          error: 'Validation error',
          message: 'Profile update failed validation',
          validationErrors
        });
        return;
      }

      // Check for CastError (invalid ObjectId, invalid type, etc.)
      if (error.name === 'CastError') {
        res.status(400).json({
          success: false,
          error: 'Invalid data format',
          message: error.message || 'One or more fields have invalid format',
          field: error.path || 'unknown',
          value: error.value
        });
        return;
      }

      // Re-throw to be handled by error handler middleware
      throw error;
    }
  }

  /**
   * GET /api/v1/profiles/internal/:uid
   * Internal service-to-service profile read (no privacy gate).
   * Used by admin-service certificate verification before review actions.
   */
  static async getProfileInternal(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { uid } = req.params;
      if (!uid) {
        res.status(400).json({
          success: false,
          error: 'uid is required',
        });
        return;
      }

      const profile = await ProfileService.getProfileByUid(uid);

      res.json({
        success: true,
        profile,
      });
    } catch (error: any) {
      logger.error('ProfileController.getProfileInternal failed', {
        uid: req.params?.uid,
        error: error.message,
      });

      const statusCode =
        error?.statusCode === 404 ||
        error?.name === 'NotFoundError' ||
        /not found/i.test(error?.message || '')
          ? 404
          : 500;

      res.status(statusCode).json({
        success: false,
        error: error.message || 'Failed to fetch profile',
      });
    }
  }

  /**
   * PUT /api/v1/profiles/internal/:uid
   * Internal service-to-service profile update endpoint.
   * Currently used by admin-service certificate verification flow.
   */
  static async updateProfileInternal(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { uid } = req.params;
      if (!uid) {
        res.status(400).json({
          success: false,
          error: 'uid is required',
        });
        return;
      }

      const profileData: Partial<IProfile> = req.body || {};
      const updatedProfile = await ProfileService.updateProfile(uid, profileData);

      res.json({
        success: true,
        message: 'Profile updated successfully',
        profile: updatedProfile,
      });
    } catch (error: any) {
      logger.error('ProfileController.updateProfileInternal failed', {
        uid: req.params?.uid,
        error: error.message,
      });
      res.status(error.statusCode || 500).json({
        success: false,
        error: error.message || 'Failed to update profile',
      });
    }
  }

  /**
   * DELETE /api/v1/profiles/me
   */
  static async deleteProfile(req: AuthenticatedRequest, res: Response): Promise<void> {
    const uid = req.user!.uid;
    const deleteResult = await ProfileService.deleteProfile(uid);

    res.json({
      success: true,
      message: 'Profile and all associated data deleted successfully',
      deletedCount: deleteResult.deletedCount,
      cascadeDeleteResult: deleteResult.cascadeDeleteResult || null
    });
  }

  /**
   * DELETE /api/v1/profiles/bulk - Bulk delete profiles by UIDs (service auth for admin operations)
   */
  static async bulkDeleteProfiles(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { uids } = req.body;

    if (!uids || !Array.isArray(uids) || uids.length === 0) {
      res.status(400).json({
        success: false,
        error: 'UIDs array is required'
      });
      return;
    }

    if (uids.length > 1000) {
      res.status(400).json({
        success: false,
        error: 'Maximum 1000 UIDs per bulk delete operation'
      });
      return;
    }

    try {
      // Use MongoDB bulk delete (optimized)
      // Note: Cascade deletion and Firebase deletion should be handled by the caller
      const deleteResult = await ProfileService.bulkDeleteProfiles(uids);

      res.json({
        success: true,
        message: 'Profiles deleted successfully',
        deletedCount: deleteResult.deletedCount,
        requestedCount: uids.length
      });
    } catch (error: any) {
      logger.error('Bulk profile delete failed:', error);
      res.status(500).json({
        success: false,
        error: 'Bulk delete failed',
        message: error.message
      });
    }
  }

  /**
   * DELETE /api/v1/profiles/:uid - Delete profile by UID (service auth for admin operations)
   */
  static async deleteProfileByUid(req: AuthenticatedRequest, res: Response): Promise<void> {
    const uid = req.params.uid;

    // For service auth, uid comes from params (route parameter)
    // For Firebase auth, uid comes from req.user.uid
    const targetUid = uid || req.user?.uid;

    if (!targetUid) {
      res.status(400).json({
        success: false,
        error: 'UID is required'
      });
      return;
    }

    const deleteResult = await ProfileService.deleteProfile(targetUid);

    res.json({
      success: true,
      message: 'Profile and all associated data deleted successfully',
      deletedCount: deleteResult.deletedCount,
      cascadeDeleteResult: deleteResult.cascadeDeleteResult || null
    });
  }

  /**
   * GET /api/v1/profiles/completion
   */
  static async getProfileCompletion(req: AuthenticatedRequest, res: Response): Promise<void> {
    const uid = req.user!.uid;
    const completion = await ProfileService.getProfileCompletion(uid);

    res.json({
      success: true,
      ...completion
    });
  }

  /**
   * GET /api/v1/profiles/onboarding-status
   */
  static async getOnboardingStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
    const uid = req.user!.uid;
    const status = await ProfileService.getOnboardingStatus(uid);

    res.json(status);
  }

  /**
   * PATCH /api/v1/profiles/:uid/verification/aadhaar
   * Update Aadhaar verification status (service-to-service call)
   */
  static async updateAadhaarVerification(req: Request, res: Response): Promise<void> {
    const { uid } = req.params;
    const {
      isAadhaarVerified,
      aadhaarVerifiedAt,
      maskedAadhaar,
      status,
      internalStatus,
      visibleStatus,
      failureReason,
    } = req.body;

    logger.debug('[USER SERVICE] Received Aadhaar verification update request', {
      uid,
      body: req.body,
      headers: {
        'x-service-auth': req.headers['x-service-auth'] ? 'present' : 'missing',
        'x-service-name': req.headers['x-service-name'],
        'x-user-id': req.headers['x-user-id']
      }
    });

    if (!uid) {
      logger.error('[USER SERVICE] Missing uid in Aadhaar verification request');
      res.status(400).json({
        success: false,
        error: 'User ID (uid) is required'
      });
      return;
    }

    try {
      // Update profile with Aadhaar verification status
      const updateData: Partial<IProfile> = {
        isAadhaarVerified: isAadhaarVerified !== undefined ? isAadhaarVerified : true,
        aadhaarVerifiedAt: aadhaarVerifiedAt ? new Date(aadhaarVerifiedAt) : new Date(),
        isVerified: true, // ✅ Set general verification flag when Aadhaar is verified
        ...(maskedAadhaar && { maskedAadhaar })
      };

      logger.debug('[USER SERVICE] Updating profile in MongoDB for Aadhaar', {
        uid,
        updateData
      });

      const updatedProfile = await ProfileService.updateProfile(uid, updateData);

      logger.debug('[USER SERVICE] Profile updated in MongoDB for Aadhaar', {
        uid,
        isAadhaarVerified: updatedProfile.isAadhaarVerified,
        aadhaarVerifiedAt: updatedProfile.aadhaarVerifiedAt
      });

      // 🎖️ Update verification badge and tier
      try {
        const badgeResult = await VerificationBadgeService.handleVerificationComplete(
          uid,
          updatedProfile._id.toString(),
          VerificationType.AADHAAR,
          { provider: 'digilocker' }
        );
        logger.info('🎖️ Badge updated after Aadhaar verification', {
          uid,
          tier: badgeResult.tier,
          badge: badgeResult.badge
        });
      } catch (badgeError: any) {
        logger.error('Failed to update badge after Aadhaar verification', badgeError);
      }

      const aadhaarStatusText = String(
        visibleStatus || internalStatus || status || '',
      ).toLowerCase();
      const shouldNotifyFailed =
        isAadhaarVerified === false ||
        ['failed', 'failure', 'rejected'].some((item) =>
          aadhaarStatusText.includes(item),
        );
      const shouldNotifyUnderReview =
        !shouldNotifyFailed &&
        ['under_review', 'under review', 'review', 'pending'].some((item) =>
          aadhaarStatusText.includes(item),
        );

      if (shouldNotifyFailed || shouldNotifyUnderReview) {
        await MainAdminNotificationClient.send({
          type: shouldNotifyFailed
            ? 'aadhaar_verification_failed'
            : 'aadhaar_verification_under_review',
          userId: updatedProfile.uid,
          userName: updatedProfile.name || undefined,
          userEmail: updatedProfile.email || undefined,
          userPhone: updatedProfile.phone || undefined,
          status: shouldNotifyFailed ? 'failed' : 'under_review',
          failureReason: failureReason || undefined,
          occurredAt: new Date().toISOString(),
        });
      }

      if (updatedProfile.isAadhaarVerified) {
        try {
          const { createPlatformEvent } = await import('../rewards/events/InProcessEventBus');
          const { QualificationEngine } = await import('../rewards/qualification/QualificationEngine');
          const enrollmentCorrelationId =
            `aadhaar:${updatedProfile.uid}:${Date.now()}`;
          const event = createPlatformEvent(
            'IDENTITY_VERIFIED',
            {
              uid: updatedProfile.uid,
              refereeUid: updatedProfile.uid,
              referrerUid: updatedProfile.uid,
              verificationType: 'aadhaar',
            },
            enrollmentCorrelationId
          );
          await QualificationEngine.processDomainEvent(event);
        } catch (qualificationError: any) {
          logger.warn('[USER SERVICE] Aadhaar qualification event processing failed', {
            uid: updatedProfile.uid,
            error: qualificationError?.message || String(qualificationError),
          });
        }
      }

      res.json({
        success: true,
        message: 'Aadhaar verification status updated',
        profile: {
          uid: updatedProfile.uid,
          isAadhaarVerified: updatedProfile.isAadhaarVerified,
          aadhaarVerifiedAt: updatedProfile.aadhaarVerifiedAt,
          maskedAadhaar: updatedProfile.maskedAadhaar
        }
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to update Aadhaar verification status'
      });
    }
  }

  /**
   * PATCH /api/v1/profiles/:uid/verification/pan
   * Update PAN verification status (service-to-service call)
   */
  static async updatePANVerification(req: Request, res: Response): Promise<void> {
    const { uid } = req.params;
    const { isPANVerified, panVerifiedAt, maskedPAN } = req.body;

    logger.debug('[USER SERVICE] Received PAN verification update request', {
      uid,
      body: req.body,
      headers: {
        'x-service-auth': req.headers['x-service-auth'] ? 'present' : 'missing',
        'x-service-name': req.headers['x-service-name'],
        'x-user-id': req.headers['x-user-id']
      }
    });

    if (!uid) {
      logger.error('[USER SERVICE] Missing uid in PAN verification request');
      res.status(400).json({
        success: false,
        error: 'User ID (uid) is required'
      });
      return;
    }

    try {
      // Update profile with PAN verification status
      const updateData: Partial<IProfile> = {
        isPANVerified: isPANVerified !== undefined ? isPANVerified : true,
        panVerifiedAt: panVerifiedAt ? new Date(panVerifiedAt) : new Date(),
        isVerified: true, // ✅ Set general verification flag when PAN is verified
        ...(maskedPAN && { maskedPan: maskedPAN })
      };

      logger.debug('[USER SERVICE] Updating profile in MongoDB for PAN', {
        uid,
        updateData
      });

      const updatedProfile = await ProfileService.updateProfile(uid, updateData);

      logger.debug('[USER SERVICE] Profile updated in MongoDB for PAN', {
        uid,
        isPANVerified: updatedProfile.isPANVerified,
        panVerifiedAt: updatedProfile.panVerifiedAt
      });

      // 🎖️ Update verification badge and tier
      try {
        const badgeResult = await VerificationBadgeService.handleVerificationComplete(
          uid,
          updatedProfile._id.toString(),
          VerificationType.PAN,
          { provider: 'cashfree' }
        );
        logger.info('🎖️ Badge updated after PAN verification', {
          uid,
          tier: badgeResult.tier,
          badge: badgeResult.badge
        });
      } catch (badgeError: any) {
        logger.error('Failed to update badge after PAN verification', badgeError);
      }

      res.json({
        success: true,
        message: 'PAN verification status updated',
        profile: {
          uid: updatedProfile.uid,
          isPANVerified: updatedProfile.isPANVerified,
          panVerifiedAt: updatedProfile.panVerifiedAt
        }
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to update PAN verification status'
      });
    }
  }

  /**
   * PATCH /api/v1/profiles/:uid/verification/bank
   * Update bank verification status (service-to-service call)
   */
  static async updateBankVerification(req: Request, res: Response): Promise<void> {
    const { uid } = req.params;
    const { isBankVerified, bankVerifiedAt, maskedBankAccount, bankAccount } = req.body;

    logger.debug('[USER SERVICE] Received bank verification update request', {
      uid,
      body: req.body,
      headers: {
        'x-service-auth': req.headers['x-service-auth'] ? 'present' : 'missing',
        'x-service-name': req.headers['x-service-name'],
        'x-user-id': req.headers['x-user-id']
      }
    });

    if (!uid) {
      logger.error('[USER SERVICE] Missing uid in bank verification request');
      res.status(400).json({
        success: false,
        error: 'User ID (uid) is required'
      });
      return;
    }

    try {
      // Update profile with bank verification status
      const updateData: Partial<IProfile> = {
        isBankVerified: isBankVerified !== undefined ? isBankVerified : true,
        bankVerifiedAt: bankVerifiedAt ? new Date(bankVerifiedAt) : new Date(),
        ...(maskedBankAccount && { maskedBankAccount }),
        ...(bankAccount && { bankAccount })
      };

      logger.debug('[USER SERVICE] Updating profile in MongoDB for bank verification', {
        uid,
        updateData
      });

      const updatedProfile = await ProfileService.updateProfile(uid, updateData);

      logger.debug('[USER SERVICE] Profile updated in MongoDB for bank verification', {
        uid,
        isBankVerified: updatedProfile.isBankVerified,
        bankVerifiedAt: updatedProfile.bankVerifiedAt
      });

      // 🎖️ Update verification badge and tier
      try {
        const badgeResult = await VerificationBadgeService.handleVerificationComplete(
          uid,
          updatedProfile._id.toString(),
          VerificationType.BANK,
          { provider: 'cashfree' }
        );
        logger.info('🎖️ Badge updated after Bank verification', {
          uid,
          tier: badgeResult.tier,
          badge: badgeResult.badge
        });
      } catch (badgeError: any) {
        logger.error('Failed to update badge after Bank verification', badgeError);
      }

      res.json({
        success: true,
        message: 'Bank verification status updated',
        profile: {
          uid: updatedProfile.uid,
          isBankVerified: updatedProfile.isBankVerified,
          bankVerifiedAt: updatedProfile.bankVerifiedAt,
          maskedBankAccount: updatedProfile.maskedBankAccount
        }
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to update bank verification status'
      });
    }
  }

  /**
   * PATCH /api/v1/profiles/:uid/verification/email
   * Update email verification status (service-to-service call)
   */
  static async updateEmailVerification(req: Request, res: Response): Promise<void> {
    const { uid } = req.params;
    const { isEmailVerified, emailVerifiedAt, email } = req.body;

    logger.debug('[USER SERVICE] Received email verification update request', {
      uid,
      body: req.body,
      headers: {
        'x-service-auth': req.headers['x-service-auth'] ? 'present' : 'missing',
        'x-service-name': req.headers['x-service-name'],
        'x-user-id': req.headers['x-user-id']
      }
    });

    if (!uid) {
      logger.error('[USER SERVICE] Missing uid in email verification request');
      res.status(400).json({
        success: false,
        error: 'User ID (uid) is required'
      });
      return;
    }

    try {
      // Update profile with email verification status
      const updateData: Partial<IProfile> = {
        isEmailVerified: isEmailVerified !== undefined ? isEmailVerified : true,
        emailVerifiedAt: emailVerifiedAt ? new Date(emailVerifiedAt) : new Date(),
        ...(email && { email })
      };

      logger.debug('[USER SERVICE] Updating profile in MongoDB for email verification', {
        uid,
        updateData
      });

      const updatedProfile = await ProfileService.updateProfile(uid, updateData);

      logger.debug('[USER SERVICE] Profile updated in MongoDB for email verification', {
        uid,
        isEmailVerified: updatedProfile.isEmailVerified,
        emailVerifiedAt: updatedProfile.emailVerifiedAt
      });

      // 🎖️ Update verification badge and tier
      try {
        const badgeResult = await VerificationBadgeService.handleVerificationComplete(
          uid,
          updatedProfile._id.toString(),
          VerificationType.EMAIL
        );
        logger.info('🎖️ Badge updated after Email verification', {
          uid,
          tier: badgeResult.tier,
          badge: badgeResult.badge
        });
      } catch (badgeError: any) {
        logger.error('Failed to update badge after Email verification', badgeError);
      }

      res.json({
        success: true,
        message: 'Email verification status updated',
        profile: {
          uid: updatedProfile.uid,
          isEmailVerified: updatedProfile.isEmailVerified,
          emailVerifiedAt: updatedProfile.emailVerifiedAt,
          email: updatedProfile.email
        }
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to update email verification status'
      });
    }
  }

  /**
   * POST /api/v1/verification/email/initiate
   * Initiate email verification by sending OTP
   */
  static async initiateEmailVerificationOTP(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
        return;
      }

      const { email } = req.body;

      if (!email) {
        res.status(400).json({
          success: false,
          error: 'Email is required'
        });
        return;
      }

      // Get user profile for name
      const profile = await ProfileService.getProfileByUid(req.user.uid);

      const result = await EmailVerificationService.initiateEmailVerification(
        req.user.uid,
        email,
        profile.name
      );

      if (result.success) {
        res.json({
          success: true,
          message: result.message,
          data: {
            verificationId: result.verificationId,
            expiresInMinutes: result.expiresInMinutes
          }
        });
      } else {
        const statusCode = result.code === 'email_already_verified' || result.code === 'email_already_verified_elsewhere'
          ? 409
          : result.code === 'email_send_failed'
            ? 502
            : 400;

        res.status(statusCode).json({
          success: false,
          error: result.message
        });
      }
    } catch (error: any) {
      logger.error('Error initiating email verification', {
        uid: req.user?.uid,
        error: error.message
      });
      res.status(500).json({
        success: false,
        error: 'Failed to initiate email verification'
      });
    }
  }

  /**
   * POST /api/v1/verification/email/verify
   * Verify email OTP
   */
  static async verifyEmailOTPCode(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
        return;
      }

      const { otp, verificationId } = req.body;

      if (!otp) {
        res.status(400).json({
          success: false,
          error: 'OTP is required'
        });
        return;
      }

      const result = await EmailVerificationService.verifyEmailOTP(
        req.user.uid,
        otp,
        verificationId
      );

      if (result.success) {
        res.json({
          success: true,
          message: result.message
        });
      } else {
        const statusCode = result.code === 'email_already_verified_elsewhere' ? 409 : 400;

        res.status(statusCode).json({
          success: false,
          error: result.message
        });
      }
    } catch (error: any) {
      logger.error('Error verifying email OTP', {
        uid: req.user?.uid,
        error: error.message
      });
      res.status(500).json({
        success: false,
        error: 'Failed to verify email'
      });
    }
  }

  /**
   * POST /api/v1/verification/email/resend
   * Resend email OTP
   */
  static async resendEmailOTPCode(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
        return;
      }

      const result = await EmailVerificationService.resendEmailOTP(req.user.uid);

      if (result.success) {
        res.json({
          success: true,
          message: result.message,
          data: {
            verificationId: result.verificationId,
            expiresInMinutes: result.expiresInMinutes
          }
        });
      } else {
        const statusCode = result.code === 'email_send_failed' ? 502 : 400;

        res.status(statusCode).json({
          success: false,
          error: result.message
        });
      }
    } catch (error: any) {
      logger.error('Error resending email OTP', {
        uid: req.user?.uid,
        error: error.message
      });
      res.status(500).json({
        success: false,
        error: 'Failed to resend verification code'
      });
    }
  }

  /**
   * GET /api/v1/verification/email/status
   * Get email verification status
   */
  static async getEmailVerificationStatusOTP(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
        return;
      }

      const result = await EmailVerificationService.getVerificationStatus(req.user.uid);

      if (result.success) {
        res.json({
          success: true,
          data: result.data
        });
      } else {
        res.status(500).json({
          success: false,
          error: result.message
        });
      }
    } catch (error: any) {
      logger.error('Error getting email verification status', {
        uid: req.user?.uid,
        error: error.message
      });
      res.status(500).json({
        success: false,
        error: 'Failed to get verification status'
      });
    }
  }

  /**
   * PUT /api/v1/profiles/me/category-alerts
   * Save user's selected categories for alerts
   */
  static async updateCategoryAlerts(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const uid = req.user!.uid;
      const { categories } = req.body;

      if (!Array.isArray(categories)) {
        res.status(400).json({
          success: false,
          error: 'Categories must be an array'
        });
        return;
      }

      // Validate tha each category has slug and name
      const validCategories = categories.every(
        cat => typeof cat === 'object' && cat.slug && cat.name
      );
      if (!validCategories) {
        res.status(400).json({
          success: false,
          error: 'Each category must have slug and name'
        });
        return;
      }

      // Limit to 10 categories
      const limitedCategories = categories.slice(0, 10);

      const profile = await ProfileService.updateCategoryAlerts(uid, limitedCategories);

      logger.info('ProfileController.updateCategoryAlerts: Categories updated', {
        uid,
        categoryCount: limitedCategories.length
      });

      res.json({
        success: true,
        data: {
          categories: profile.savedCategories?.categories || []
        }
      });
    } catch (error: any) {
      logger.error('Error updating category alerts', {
        uid: req.user?.uid,
        error: error.message
      });
      res.status(500).json({
        success: false,
        error: 'Failed to update category alerts'
      });
    }
  }

  /**
   * GET /api/v1/profiles/me/category-alerts
   * Get user's selected categories for alerts
   */
  static async getCategoryAlerts(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const uid = req.user!.uid;
      
      const profile = await ProfileService.getMyProfile(uid);

      res.json({
        success: true,
        data: {
          categories: profile.savedCategories?.categories || []
        }
      });
    } catch (error: any) {
      logger.error('Error getting category alerts', {
        uid: req.user?.uid,
        error: error.message
      });
      res.status(500).json({
        success: false,
        error: 'Failed to get category alerts'
      });
    }
  }

  /**
   * PUT /api/v1/profiles/me/keyword-alerts
   * Save user's selected keywords for alerts
   */
  static async updateKeywordAlerts(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const uid = req.user!.uid;
      const { keywords } = req.body;

      if (!Array.isArray(keywords)) {
        res.status(400).json({
          success: false,
          error: 'Keywords must be an array'
        });
        return;
      }

      const normalizedKeywords = keywords
        .map((k) => (typeof k === 'string' ? k.trim().toLowerCase() : ''))
        .filter((k) => k.length >= 2 && k.length <= 30)
        .slice(0, 10);

      const profile = await ProfileService.updateKeywordAlerts(uid, normalizedKeywords);

      logger.info('ProfileController.updateKeywordAlerts: Keywords updated', {
        uid,
        keywordCount: normalizedKeywords.length
      });

      res.json({
        success: true,
        data: {
          keywords: profile.savedKeywords?.keywords || []
        }
      });
    } catch (error: any) {
      logger.error('Error updating keyword alerts', {
        uid: req.user?.uid,
        error: error.message
      });
      res.status(500).json({
        success: false,
        error: 'Failed to update keyword alerts'
      });
    }
  }

  /**
   * GET /api/v1/profiles/me/keyword-alerts
   * Get user's selected keywords for alerts
   */
  static async getKeywordAlerts(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const uid = req.user!.uid;
      const profile = await ProfileService.getMyProfile(uid);

      res.json({
        success: true,
        data: {
          keywords: profile.savedKeywords?.keywords || []
        }
      });
    } catch (error: any) {
      logger.error('Error getting keyword alerts', {
        uid: req.user?.uid,
        error: error.message
      });
      res.status(500).json({
        success: false,
        error: 'Failed to get keyword alerts'
      });
    }
  }

  /**
   * POST /api/v1/profiles/check-phone
   * Check if a phone number is available (not already used by another profile).
   */
  static async checkPhoneAvailability(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { phone } = req.body;
    const currentUid = req.user!.uid;

    if (!phone || typeof phone !== 'string') {
      res.status(400).json({ success: false, error: 'Phone number is required' });
      return;
    }

    const normalised = phone.trim();

    try {
      const existing = await Profile.findOne({ phone: normalised }).lean();

      // Available if no profile owns it, or the only owner is the current user
      if (!existing || existing.uid === currentUid) {
        res.json({ success: true, available: true });
      } else {
        res.json({ success: true, available: false, message: 'Phone number already registered' });
      }
    } catch (error: any) {
      logger.error('checkPhoneAvailability error', { error: error.message });
      res.status(500).json({ success: false, error: 'Failed to check phone availability' });
    }
  }

  /**
   * PUT /api/v1/profiles/change-phone
   * Update the authenticated user's phone number after OTP verification.
   * Identified by Firebase UID — never changes UID.
   */
  static async changePhone(req: AuthenticatedRequest, res: Response): Promise<void> {
    const uid = req.user!.uid;
    const { phone } = req.body;

    if (!phone || typeof phone !== 'string') {
      res.status(400).json({ success: false, error: 'Phone number is required' });
      return;
    }

    const normalised = phone.trim();

    try {
      // Double-check uniqueness before writing
      const conflict = await Profile.findOne({ phone: normalised, uid: { $ne: uid } }).lean();
      if (conflict) {
        res.status(409).json({ success: false, error: 'Phone number already registered to another account' });
        return;
      }

      const updated = await Profile.findOneAndUpdate(
        { uid },
        { $set: { phone: normalised, phoneVerified: true } },
        { new: true, runValidators: true }
      ).lean();

      if (!updated) {
        res.status(404).json({ success: false, error: 'Profile not found' });
        return;
      }

      logger.info('Phone number updated', { uid, phone: normalised });
      res.json({ success: true, data: updated });
    } catch (error: any) {
      // Handle MongoDB duplicate key error (race condition)
      if (error.code === 11000) {
        res.status(409).json({ success: false, error: 'Phone number already registered to another account' });
        return;
      }
      logger.error('changePhone error', { uid, error: error.message });
      res.status(500).json({ success: false, error: 'Failed to update phone number' });
    }
  }
}
