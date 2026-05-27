import { Router, Request, Response } from 'express';
import { ProfileController } from '../controllers/ProfileController';
import { AddressController } from '../controllers/AddressController';
import { optionalAuthMiddleware, authMiddleware } from '../middleware/auth';
import { serviceAuthMiddleware } from '../middleware/serviceAuth';
import { asyncHandler } from '../middleware/errorHandler';
import profileStatsRoutes from './profileStats';
import Profile from '../models/Profile';

const router = Router();

// GET /api/v1/profiles/search - Search profiles (requires auth)
router.get('/search', authMiddleware, asyncHandler(ProfileController.searchProfiles));

// POST /api/v1/profiles/internal/match-users - Service-to-service endpoint for matching users
// Used by task-service to find taskers when a task is created
router.post('/internal/match-users', serviceAuthMiddleware, asyncHandler(ProfileController.matchUsers));
router.get(
  '/internal/certificates/queue',
  serviceAuthMiddleware,
  asyncHandler(ProfileController.getInternalCertificateQueue)
);
router.get(
  '/internal/certificates/analytics',
  serviceAuthMiddleware,
  asyncHandler(ProfileController.getInternalCertificateAnalytics)
);
router.get(
  '/internal/stats/taskers/aadhaar-verified',
  serviceAuthMiddleware,
  asyncHandler(ProfileController.getInternalTaskerAadhaarVerifiedCount)
);
router.get(
  '/internal/stats/taskers/category-counts',
  serviceAuthMiddleware,
  asyncHandler(ProfileController.getInternalTaskerCategoryCounts)
);
router.get(
  '/internal/:uid',
  serviceAuthMiddleware,
  asyncHandler(ProfileController.getProfileInternal)
);
router.put(
  '/internal/:uid',
  serviceAuthMiddleware,
  asyncHandler(ProfileController.updateProfileInternal)
);

// Profile Stats Routes - must come before /me to avoid conflicts
router.use('/me/stats', authMiddleware, profileStatsRoutes);

// GET /api/v1/profiles/me - Get current user's profile (requires auth)
router.get('/me', authMiddleware, asyncHandler(ProfileController.getMyProfile));

// GET /api/v1/profiles/completion - Get profile completion (requires auth)
router.get('/completion', authMiddleware, asyncHandler(ProfileController.getProfileCompletion));

// GET /api/v1/profiles/onboarding-status - Get onboarding status (requires auth)
router.get('/onboarding-status', authMiddleware, asyncHandler(ProfileController.getOnboardingStatus));

// GET /api/v1/profiles/:userId/stats - Get public profile stats (no auth required)
router.get('/:userId/stats', asyncHandler(async (req: Request, res: Response) => {
   try {
      const { userId } = req.params;
      
      // Check if userId is MongoDB ObjectId or Firebase UID
      const isMongoId = /^[0-9a-fA-F]{24}$/.test(userId);
      
      let profile;
      if (isMongoId) {
         profile = await Profile.findById(userId);
      } else {
         profile = await Profile.findOne({ uid: userId });
      }
      
      if (!profile) {
         return res.status(404).json({
            success: false,
            error: 'Profile not found',
         });
      }

      // Calculate real-time stats from task-service
      const { statsService } = await import('../services/StatsService');
      const calculatedStats = await statsService.calculateAllStats(
         profile._id.toString(),
         profile.uid
      );

      return res.status(200).json({
         success: true,
         data: {
            totalTasks: calculatedStats.totalTasks,
            completedTasks: calculatedStats.completedTasks,
            postedTasks: calculatedStats.postedTasks,
            totalReviews: calculatedStats.totalReviews,
            rating: Math.round(calculatedStats.avgRating * 10) / 10,
            ...(calculatedStats.ratingBreakdowns && {
               ratingBreakdowns: calculatedStats.ratingBreakdowns,
            }),
         },
      });
   } catch (error: any) {
      console.error('Error fetching profile stats:', error);
      return res.status(500).json({
         success: false,
         error: 'Failed to fetch statistics',
         details: error.message,
      });
   }
}));

// GET /api/v1/profiles/public/id/:profileId - Get public profile by MongoDB ObjectId (no auth required)
router.get('/public/id/:profileId', optionalAuthMiddleware, asyncHandler(ProfileController.getPublicProfileById));

// GET /api/v1/profiles/public/:uid - Get public profile (no auth required)
router.get('/public/:uid', optionalAuthMiddleware, asyncHandler(ProfileController.getPublicProfile));

// GET /api/v1/profiles/by-id/:profileId - Get profile by ObjectId (for enrichment - service auth)
router.get('/by-id/:profileId', serviceAuthMiddleware, asyncHandler(ProfileController.getProfileById));

// POST /api/v1/profiles/batch - Get multiple profiles by ObjectIds (for enrichment - service auth)
router.post('/batch', serviceAuthMiddleware, asyncHandler(ProfileController.getProfilesBatch));

// POST /api/v1/profiles/batch/uids - Get multiple profiles by Firebase UIDs (for enrichment - service auth)
router.post('/batch/uids', serviceAuthMiddleware, asyncHandler(ProfileController.getProfilesBatchByUids));

// GET /api/v1/profiles/:uid - Get profile by UID (optional auth)
// Note: This route must come after /by-id/:profileId to avoid route conflicts
router.get('/:uid', optionalAuthMiddleware, asyncHandler(ProfileController.getProfile));

// POST /api/v1/profiles - Create profile (accepts Firebase auth OR service auth)
router.post('/', authMiddleware, asyncHandler(ProfileController.createProfile));

// PUT /api/v1/profiles/me/category-alerts - Save category alerts (requires auth)
router.put('/me/category-alerts', authMiddleware, asyncHandler(ProfileController.updateCategoryAlerts));

// GET /api/v1/profiles/me/category-alerts - Get category alerts (requires auth)
router.get('/me/category-alerts', authMiddleware, asyncHandler(ProfileController.getCategoryAlerts));

// PUT /api/v1/profiles/me/keyword-alerts - Save keyword alerts (requires auth)
router.put('/me/keyword-alerts', authMiddleware, asyncHandler(ProfileController.updateKeywordAlerts));

// GET /api/v1/profiles/me/keyword-alerts - Get keyword alerts (requires auth)
router.get('/me/keyword-alerts', authMiddleware, asyncHandler(ProfileController.getKeywordAlerts));

// POST /api/v1/profiles/check-phone - Check phone availability (requires auth)
router.post('/check-phone', authMiddleware, asyncHandler(ProfileController.checkPhoneAvailability));

// PUT /api/v1/profiles/change-phone - Change phone number after OTP verification (requires auth)
router.put('/change-phone', authMiddleware, asyncHandler(ProfileController.changePhone));

// PUT /api/v1/profiles/me - Update profile (requires auth)
router.put('/me', authMiddleware, asyncHandler(ProfileController.updateProfile));

// PATCH /api/v1/profiles/:uid/verification/aadhaar - Update Aadhaar verification (service auth)
router.patch('/:uid/verification/aadhaar', serviceAuthMiddleware, asyncHandler(ProfileController.updateAadhaarVerification));

// PATCH /api/v1/profiles/:uid/verification/pan - Update PAN verification (service auth)
router.patch('/:uid/verification/pan', serviceAuthMiddleware, asyncHandler(ProfileController.updatePANVerification));

// PATCH /api/v1/profiles/:uid/verification/bank - Update bank verification (service auth)
router.patch('/:uid/verification/bank', serviceAuthMiddleware, asyncHandler(ProfileController.updateBankVerification));

// PATCH /api/v1/profiles/:uid/verification/email - Update email verification (service auth)
router.patch('/:uid/verification/email', serviceAuthMiddleware, asyncHandler(ProfileController.updateEmailVerification));

// Address Management Routes
// GET /api/v1/profiles/me/addresses - Get all saved addresses (requires auth)
router.get('/me/addresses', authMiddleware, asyncHandler(AddressController.getAddresses));

// POST /api/v1/profiles/me/addresses - Add new address (requires auth)
router.post('/me/addresses', authMiddleware, asyncHandler(AddressController.addAddress));

// PUT /api/v1/profiles/me/addresses/:addressId - Update address (requires auth)
router.put('/me/addresses/:addressId', authMiddleware, asyncHandler(AddressController.updateAddress));

// PATCH /api/v1/profiles/me/addresses/:addressId/default - Set default address (requires auth)
router.patch('/me/addresses/:addressId/default', authMiddleware, asyncHandler(AddressController.setDefaultAddress));

// DELETE /api/v1/profiles/me/addresses/:addressId - Delete address (requires auth)
router.delete('/me/addresses/:addressId', authMiddleware, asyncHandler(AddressController.deleteAddress));

// DELETE /api/v1/profiles/me - Delete profile (requires auth)
router.delete('/me', authMiddleware, asyncHandler(ProfileController.deleteProfile));

// DELETE /api/v1/profiles/bulk - Bulk delete profiles (service auth for admin operations)
// Note: This route must come before /:uid to avoid route conflicts
router.delete('/bulk', authMiddleware, asyncHandler(ProfileController.bulkDeleteProfiles));

// DELETE /api/v1/profiles/:uid - Delete profile by UID (service auth for admin operations)
// Note: This route must come after /me and /bulk to avoid route conflicts
router.delete('/:uid', authMiddleware, asyncHandler(ProfileController.deleteProfileByUid));

export default router;


