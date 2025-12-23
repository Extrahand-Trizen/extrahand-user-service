import { Router } from 'express';
import { AuthController } from '../controllers/AuthController';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

// POST /api/v1/auth/check-phone (PUBLIC - no auth required)
router.post('/check-phone', asyncHandler(AuthController.checkPhone));

// POST /api/v1/auth/sync (Authenticated - handled via global auth middleware)
router.post("/sync", asyncHandler(AuthController.sync));

// POST /api/v1/auth/otp/complete (PUBLIC - no auth required, but requires valid ID token in body)
router.post('/otp/complete', asyncHandler(AuthController.completeOTP));

export default router;

