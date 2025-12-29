import { Router } from 'express';
import { BusinessController } from '../controllers/BusinessController';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

// All business routes require authentication (accepts service auth from API Gateway OR Firebase token)
router.use(authMiddleware);

// POST /api/v1/business/details
router.post('/details', asyncHandler(BusinessController.saveBusinessDetails));

// POST /api/v1/business/pan/verify
router.post('/pan/verify', asyncHandler(BusinessController.verifyPAN));

// POST /api/v1/business/bank/verify
router.post('/bank/verify', asyncHandler(BusinessController.verifyBank));

// POST /api/v1/business/gst/verify
router.post('/gst/verify', asyncHandler(BusinessController.verifyGST));

// POST /api/v1/business/document/upload
router.post('/document/upload', asyncHandler(BusinessController.uploadDocument));

// GET /api/v1/business/status
router.get('/status', asyncHandler(BusinessController.getBusinessStatus));

export default router;


