import { Router } from 'express';
import { UserController } from '../controllers/UserController';
import { serviceAuthMiddleware } from '../middleware/serviceAuth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

// Admin endpoints for user management
// All routes require service authentication (from main-admin-service)

// GET /api/v1/users - List users with filters (admin)
router.get('/', serviceAuthMiddleware, asyncHandler(UserController.listUsersForAdmin));

// GET /api/v1/users/stats/roles - Role counts from profiles.roles (admin)
router.get('/stats/roles', serviceAuthMiddleware, asyncHandler(UserController.getRoleCountsForAdmin));

// GET /api/v1/users/areas/hyderabad - Hyderabad sub-areas for admin filters
router.get('/areas/hyderabad', serviceAuthMiddleware, asyncHandler(UserController.getHyderabadSubAreasForAdmin));

// GET /api/v1/users/cleanup/no-role - Preview users with no role (dry run)
router.get('/cleanup/no-role', serviceAuthMiddleware, asyncHandler(UserController.cleanupUsersWithoutRoles));

// POST /api/v1/users/cleanup/no-role - Actually delete users with no role (dry_run=false)
router.post('/cleanup/no-role', serviceAuthMiddleware, asyncHandler(UserController.cleanupUsersWithoutRoles));

// GET /api/v1/users/helpers/search - Search helpers by name or phone (admin)
router.get('/helpers/search', serviceAuthMiddleware, asyncHandler(UserController.searchHelpers));

// GET /api/v1/users/:userId - Get user by UID (admin)
router.get('/:userId', serviceAuthMiddleware, asyncHandler(UserController.getUserForAdmin));

// PATCH /api/v1/users/:userId - Update user (admin)
router.patch('/:userId', serviceAuthMiddleware, asyncHandler(UserController.updateUserForAdmin));

// POST /api/v1/users/:userId/ban - Ban user (admin)
router.post('/:userId/ban', serviceAuthMiddleware, asyncHandler(UserController.banUser));

// POST /api/v1/users/:userId/unban - Unban user (admin)
router.post('/:userId/unban', serviceAuthMiddleware, asyncHandler(UserController.unbanUser));

// POST /api/v1/users/:userId/suspend - Suspend user (admin)
router.post('/:userId/suspend', serviceAuthMiddleware, asyncHandler(UserController.suspendUser));

// POST /api/v1/users/:userId/unsuspend - Unsuspend user (admin)
router.post('/:userId/unsuspend', serviceAuthMiddleware, asyncHandler(UserController.unsuspendUser));

export default router;
