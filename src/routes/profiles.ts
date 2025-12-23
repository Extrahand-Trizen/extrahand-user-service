import { Router } from 'express';
import { ProfileController } from '../controllers/ProfileController';
import { authMiddleware, optionalAuthMiddleware, combinedAuthMiddleware } from '../middleware/auth';
import { serviceAuthMiddleware } from '../middleware/serviceAuth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

// GET /api/v1/profiles/search - Search profiles (requires auth)
router.get('/search', authMiddleware, asyncHandler(ProfileController.searchProfiles));

// GET /api/v1/profiles/me - Get current user's profile (requires auth)
router.get('/me', authMiddleware, asyncHandler(ProfileController.getMyProfile));

// GET /api/v1/profiles/completion - Get profile completion (requires auth)
router.get('/completion', authMiddleware, asyncHandler(ProfileController.getProfileCompletion));

// GET /api/v1/profiles/onboarding-status - Get onboarding status (requires auth)
router.get('/onboarding-status', authMiddleware, asyncHandler(ProfileController.getOnboardingStatus));

// GET /api/v1/profiles/public/:uid - Get public profile (no auth required)
router.get('/public/:uid', asyncHandler(ProfileController.getPublicProfile));

// GET /api/v1/profiles/:uid - Get profile by UID (optional auth)
router.get('/:uid', optionalAuthMiddleware, asyncHandler(ProfileController.getProfile));

// POST /api/v1/profiles - Create profile (accepts Firebase auth OR service auth)
router.post('/', combinedAuthMiddleware, asyncHandler(ProfileController.createProfile));

// PUT /api/v1/profiles/me - Update profile (requires auth)
router.put('/me', authMiddleware, asyncHandler(ProfileController.updateProfile));

// PATCH /api/v1/profiles/:uid/verification/aadhaar - Update Aadhaar verification (service auth)
router.patch('/:uid/verification/aadhaar', serviceAuthMiddleware, asyncHandler(ProfileController.updateAadhaarVerification));

// PATCH /api/v1/profiles/:uid/verification/pan - Update PAN verification (service auth)
router.patch('/:uid/verification/pan', serviceAuthMiddleware, asyncHandler(ProfileController.updatePANVerification));

// DELETE /api/v1/profiles/me - Delete profile (requires auth)
router.delete('/me', authMiddleware, asyncHandler(ProfileController.deleteProfile));

// DELETE /api/v1/profiles/bulk - Bulk delete profiles (service auth for admin operations)
// Note: This route must come before /:uid to avoid route conflicts
router.delete('/bulk', combinedAuthMiddleware, asyncHandler(ProfileController.bulkDeleteProfiles));

// DELETE /api/v1/profiles/:uid - Delete profile by UID (service auth for admin operations)
// Note: This route must come after /me and /bulk to avoid route conflicts
router.delete('/:uid', combinedAuthMiddleware, asyncHandler(ProfileController.deleteProfileByUid));

export default router;


