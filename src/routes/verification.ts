import { Router } from 'express';
import { ProfileController } from '../controllers/ProfileController';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

// POST /api/v1/verification/email/initiate - Initiate email verification (send OTP)
router.post('/email/initiate', authMiddleware, asyncHandler(ProfileController.initiateEmailVerificationOTP));

// POST /api/v1/verification/email/verify - Verify email OTP
router.post('/email/verify', authMiddleware, asyncHandler(ProfileController.verifyEmailOTPCode));

// POST /api/v1/verification/email/resend - Resend email OTP
router.post('/email/resend', authMiddleware, asyncHandler(ProfileController.resendEmailOTPCode));

// GET /api/v1/verification/email/status - Get email verification status
router.get('/email/status', authMiddleware, asyncHandler(ProfileController.getEmailVerificationStatusOTP));

export default router;
