import { Router } from 'express';
import { AuthController } from '../controllers/AuthController';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

// POST /api/v1/auth/signup
router.post('/signup', asyncHandler(AuthController.signup));

// POST /api/v1/auth/login
router.post('/login', asyncHandler(AuthController.login));

// POST /api/v1/auth/password/reset
router.post('/password/reset', asyncHandler(AuthController.passwordReset));

// POST /api/v1/auth/check-phone (PUBLIC - no auth required)
router.post('/check-phone', asyncHandler(AuthController.checkPhone));

export default router;

