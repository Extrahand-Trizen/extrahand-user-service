import { Request, Response } from 'express';
import { ProfileService } from '../services/ProfileService';
import logger from '../config/logger';
import { BadRequestError } from '../errors/AppError';

interface AuthenticatedRequest extends Request {
  admin?: {
    userId?: string;
  };
}

export class UserController {
  /**
   * GET /api/v1/users/stats/roles
   * Aggregate role counts from profiles collection (admin/service).
   */
  static async getRoleCountsForAdmin(_req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const result = await ProfileService.getRoleCountsForAdmin();

      res.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      logger.error('Error in getRoleCountsForAdmin:', error);
      res.status(error.statusCode || 500).json({
        success: false,
        error: error.message || 'Failed to get role counts',
      });
    }
  }

  /**
   * POST /api/v1/users/cleanup/no-role
   * Preview (dry_run=true, default) or delete users with no saved role.
   * Pass ?dry_run=false in body/query to actually delete.
   */
  static async cleanupUsersWithoutRoles(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      // Support both query param and body to allow GET-style dry-run checks
      const dryRunParam = req.query.dry_run ?? (req.body && req.body.dry_run);
      const dryRun = dryRunParam === undefined ? true : String(dryRunParam) !== 'false';

      logger.info(`[cleanupUsersWithoutRoles] Called — dryRun=${dryRun}`, {
        adminId: req.admin?.userId,
      });

      const result = await ProfileService.cleanupUsersWithoutRoles(dryRun);

      res.json({
        success: true,
        data: result,
        message: dryRun
          ? `Dry run: found ${result.count} users with no role. Pass dry_run=false to delete.`
          : `Deleted ${result.deletedCount} of ${result.count} users with no role.`,
      });
    } catch (error: any) {
      logger.error('Error in cleanupUsersWithoutRoles:', error);
      res.status(error.statusCode || 500).json({
        success: false,
        error: error.message || 'Failed to cleanup users without roles',
      });
    }
  }

  /**
   * GET /api/v1/users
   * List users with filters (admin)
   */
  static async listUsersForAdmin(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const {
        page = '1',
        limit = '20',
        search,
        status,
        role,
        category,
        isAadhaarVerified,
        isCertified,
        createdFrom,
        createdTo,
        sortBy = 'createdAt',
        sortOrder = 'desc',
        area,
      } = req.query;

      const parsedAadhaarVerified =
        typeof isAadhaarVerified === 'string'
          ? isAadhaarVerified === 'true'
            ? true
            : isAadhaarVerified === 'false'
              ? false
              : undefined
          : undefined;

      const parsedCertified =
        typeof isCertified === 'string'
          ? isCertified === 'true'
            ? true
            : isCertified === 'false'
              ? false
              : undefined
          : undefined;

      const result = await ProfileService.listUsersForAdmin({
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        search: search as string,
        status: status as string,
        role: role as string,
        category: category as string,
        city: req.query.city as string,
        workArea: req.query.workArea as string,
        area: area as string,
        includeSummary:
          typeof req.query.includeSummary === 'string'
            ? req.query.includeSummary === 'true'
            : undefined,
        isAadhaarVerified: parsedAadhaarVerified,
        isCertified: parsedCertified,
        createdFrom: createdFrom as string,
        createdTo: createdTo as string,
        sortBy: sortBy as string,
        sortOrder: sortOrder as 'asc' | 'desc',
      });

      res.json({
        success: true,
        data: result.data,
        pagination: result.pagination,
        summary: result.summary,
      });
    } catch (error: any) {
      logger.error('Error in listUsersForAdmin:', {
        error: error.message,
        stack: error.stack,
        query: req.query,
      });
      res.status(error.statusCode || 500).json({
        success: false,
        error: error.message || 'Failed to list users',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      });
    }
  }

  /**
   * GET /api/v1/users/areas/hyderabad
   * List distinct Hyderabad sub-areas for admin filters.
   */
  static async getHyderabadSubAreasForAdmin(_req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const areas = await ProfileService.getHyderabadSubAreas();
      res.json({ success: true, data: areas });
    } catch (error: any) {
      logger.error('Error in getHyderabadSubAreasForAdmin:', error);
      res.status(error.statusCode || 500).json({
        success: false,
        error: error.message || 'Failed to list Hyderabad sub-areas',
      });
    }
  }

  /**
   * GET /api/v1/users/:userId
   * Get user by UID (admin) - returns full profile data
   */
  static async getUserForAdmin(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { userId } = req.params;

      if (!userId) {
        throw new BadRequestError('User ID is required');
      }

      const profile = await ProfileService.getUserForAdmin(userId);

      res.json({
        success: true,
        data: profile,
      });
    } catch (error: any) {
      logger.error('Error in getUserForAdmin:', error);
      res.status(error.statusCode || 500).json({
        success: false,
        error: error.message || 'Failed to get user',
      });
    }
  }

  /**
   * PATCH /api/v1/users/:userId
   * Update user (admin)
   */
  static async updateUserForAdmin(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { userId } = req.params;
      const updates = req.body;
      const adminUserId = req.headers['x-user-id'] as string;

      if (!userId) {
        throw new BadRequestError('User ID is required');
      }

      const updatedProfile = await ProfileService.updateUserForAdmin(
        userId,
        updates,
        adminUserId
      );

      res.json({
        success: true,
        data: updatedProfile,
      });
    } catch (error: any) {
      logger.error('Error in updateUserForAdmin:', error);
      res.status(error.statusCode || 500).json({
        success: false,
        error: error.message || 'Failed to update user',
      });
    }
  }

  /**
   * POST /api/v1/users/:userId/ban
   * Ban user (admin)
   */
  static async banUser(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { userId } = req.params;
      const { reason } = req.body;
      const adminUserId = req.headers['x-user-id'] as string;

      if (!userId) {
        throw new BadRequestError('User ID is required');
      }

      if (!reason || !reason.trim()) {
        throw new BadRequestError('Ban reason is required');
      }

      const updatedProfile = await ProfileService.banUser(userId, reason, adminUserId);

      res.json({
        success: true,
        data: updatedProfile,
        message: 'User banned successfully',
      });
    } catch (error: any) {
      logger.error('Error in banUser:', error);
      res.status(error.statusCode || 500).json({
        success: false,
        error: error.message || 'Failed to ban user',
      });
    }
  }

  /**
   * POST /api/v1/users/:userId/unban
   * Unban user (admin)
   */
  static async unbanUser(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { userId } = req.params;
      const adminUserId = req.headers['x-user-id'] as string;

      if (!userId) {
        throw new BadRequestError('User ID is required');
      }

      const updatedProfile = await ProfileService.unbanUser(userId, adminUserId);

      res.json({
        success: true,
        data: updatedProfile,
        message: 'User unbanned successfully',
      });
    } catch (error: any) {
      logger.error('Error in unbanUser:', error);
      res.status(error.statusCode || 500).json({
        success: false,
        error: error.message || 'Failed to unban user',
      });
    }
  }

  /**
   * POST /api/v1/users/:userId/suspend
   * Suspend user (admin)
   */
  static async suspendUser(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { userId } = req.params;
      const { reason } = req.body;
      const adminUserId = req.headers['x-user-id'] as string;

      if (!userId) {
        throw new BadRequestError('User ID is required');
      }

      if (!reason || !reason.trim()) {
        throw new BadRequestError('Suspend reason is required');
      }

      const updatedProfile = await ProfileService.suspendUser(userId, reason, adminUserId);

      res.json({
        success: true,
        data: updatedProfile,
        message: 'User suspended successfully',
      });
    } catch (error: any) {
      logger.error('Error in suspendUser:', error);
      res.status(error.statusCode || 500).json({
        success: false,
        error: error.message || 'Failed to suspend user',
      });
    }
  }

  /**
   * POST /api/v1/users/:userId/unsuspend
   * Unsuspend user (admin)
   */
  static async unsuspendUser(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { userId } = req.params;
      const adminUserId = req.headers['x-user-id'] as string;

      if (!userId) {
        throw new BadRequestError('User ID is required');
      }

      const updatedProfile = await ProfileService.unsuspendUser(userId, adminUserId);

      res.json({
        success: true,
        data: updatedProfile,
        message: 'User unsuspended successfully',
      });
    } catch (error: any) {
      logger.error('Error in unsuspendUser:', error);
      res.status(error.statusCode || 500).json({
        success: false,
        error: error.message || 'Failed to unsuspend user',
      });
    }
  }
  /**
   * GET /api/v1/users/helpers/search?q=<query>
   * Search helpers (taskers) by name or phone number (admin use for Assign Helper modal).
   */
  static async searchHelpers(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const q = (req.query.q as string || '').trim();
      if (!q) {
        res.json({ success: true, data: [] });
        return;
      }
      const helpers = await ProfileService.searchHelpers(q);
      res.json({ success: true, data: helpers });
    } catch (error: any) {
      logger.error('Error in searchHelpers:', error);
      res.status(error.statusCode || 500).json({
        success: false,
        error: error.message || 'Failed to search helpers',
      });
    }
  }
}
