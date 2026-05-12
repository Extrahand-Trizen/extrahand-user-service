import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { InquiryController } from '../controllers/InquiryController';

const router = Router();

// POST /api/v1/inquiries - submit contact inquiry (requires authenticated user)
router.post('/', authMiddleware, asyncHandler(InquiryController.createInquiry));

export default router;
