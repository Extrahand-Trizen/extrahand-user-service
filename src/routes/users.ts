import { Router } from 'express';
import { UserController } from '../controllers/UserController';
import { serviceAuthMiddleware } from '../middleware/serviceAuth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

// Admin endpoints for user management
// All routes require service authentication (from main-admin-service)

// GET /api/v1/users - List users with filters (admin)
router.get('/', serviceAuthMiddleware, asyncHandler(UserController.listUsersForAdmin));

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
