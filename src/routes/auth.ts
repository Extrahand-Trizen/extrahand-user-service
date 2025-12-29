import { Router } from "express";
import { AuthController } from "../controllers/AuthController";
import { asyncHandler } from "../middleware/errorHandler";
import { authMiddleware } from "../middleware/auth";

const router = Router();

// POST /api/v1/auth/signup
// router.post("/signup", asyncHandler(AuthController.signup));

// // POST /api/v1/auth/login
// router.post("/login", asyncHandler(AuthController.login));

// // POST /api/v1/auth/password/reset
// router.post("/password/reset", asyncHandler(AuthController.passwordReset));

// POST /api/v1/auth/check-phone (PUBLIC - no auth required)
router.post('/check-phone', asyncHandler(AuthController.checkPhone));

// POST /api/v1/auth/sync (Authenticated - accepts service auth from API Gateway OR Firebase token)
router.post("/sync", authMiddleware, asyncHandler(AuthController.sync));

// POST /api/v1/auth/otp/complete (PUBLIC - no auth required, but requires valid ID token in body)
router.post('/otp/complete', asyncHandler(AuthController.completeOTP));

export default router;

