import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import IssueReportController from '../controllers/IssueReportController';

const router = Router();

router.post('/', authMiddleware, asyncHandler(IssueReportController.create));
router.get('/', authMiddleware, asyncHandler(IssueReportController.listMine));

export default router;
