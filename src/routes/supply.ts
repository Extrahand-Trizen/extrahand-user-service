import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { serviceAuthMiddleware } from '../middleware/serviceAuth';
import { asyncHandler } from '../middleware/errorHandler';
import { SupplyController } from '../controllers/SupplyController';

const router = Router();

// Authenticated partner supply routes
router.get('/me/supply', authMiddleware, asyncHandler(SupplyController.getMySupply));
router.patch('/me/supply/profile', authMiddleware, asyncHandler(SupplyController.patchPartnerProfile));
router.get('/me/partner', authMiddleware, asyncHandler(SupplyController.getMyPartnerAlias));

router.post('/me/supply/capabilities', authMiddleware, asyncHandler(SupplyController.createCapability));
router.patch('/me/supply/capabilities/:id', authMiddleware, asyncHandler(SupplyController.updateCapability));

router.get('/me/supply/applications', authMiddleware, asyncHandler(SupplyController.listApplications));
router.post('/me/supply/applications', authMiddleware, asyncHandler(SupplyController.submitApplication));

router.post('/me/supply/service-areas', authMiddleware, asyncHandler(SupplyController.upsertServiceArea));
router.get('/me/supply/service-areas', authMiddleware, asyncHandler(SupplyController.listServiceAreas));

router.patch('/me/supply/availability', authMiddleware, asyncHandler(SupplyController.updateAvailability));

router.post('/me/supply/documents', authMiddleware, asyncHandler(SupplyController.createDocument));
router.get('/me/supply/documents', authMiddleware, asyncHandler(SupplyController.listDocuments));

// Internal dispatch query
router.get(
  '/internal/supply/eligible',
  serviceAuthMiddleware,
  asyncHandler(SupplyController.getEligiblePartners),
);

// Admin supply routes (service auth from main-admin)
router.get(
  '/internal/supply/applications/pending',
  serviceAuthMiddleware,
  asyncHandler(SupplyController.listPendingApplicationsAdmin),
);
router.post(
  '/internal/supply/applications/:id/approve',
  serviceAuthMiddleware,
  asyncHandler(SupplyController.approveApplication),
);
router.post(
  '/internal/supply/applications/:id/reject',
  serviceAuthMiddleware,
  asyncHandler(SupplyController.rejectApplication),
);
router.post(
  '/internal/supply/partners/:profileId/suspend',
  serviceAuthMiddleware,
  asyncHandler(SupplyController.suspendPartner),
);

export default router;
