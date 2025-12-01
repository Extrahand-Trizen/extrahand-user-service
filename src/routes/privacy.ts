import { Router } from 'express';
import { PrivacyController } from '../controllers/PrivacyController';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

// All privacy routes require authentication
router.use(authMiddleware);

// GET /api/v1/privacy/data-export
router.get('/data-export', asyncHandler(PrivacyController.exportData));

// GET /api/v1/privacy/dashboard
router.get('/dashboard', asyncHandler(PrivacyController.getDashboard));

// POST /api/v1/privacy/consent
router.post('/consent', asyncHandler(PrivacyController.updateConsent));

// GET /api/v1/privacy/consent
router.get('/consent', asyncHandler(PrivacyController.getConsent));

// DELETE /api/v1/privacy/delete-account
router.delete('/delete-account', asyncHandler(PrivacyController.requestDeletion));

// POST /api/v1/privacy/cancel-deletion
router.post('/cancel-deletion', asyncHandler(PrivacyController.cancelDeletion));

// POST /api/v1/privacy/execute-deletion (Internal/Cron job - should be protected by service auth)
router.post('/execute-deletion', asyncHandler(PrivacyController.executeDeletion));

export default router;


