import express, { Router } from 'express';
import { BadgeController } from '../controllers/BadgeController';
import { authMiddleware } from '../middleware/auth';

const router: Router = express.Router();

// User badge endpoints (authenticated)
router.get('/badge', authMiddleware, BadgeController.getUserBadge);
router.get('/badge/progress', authMiddleware, BadgeController.getBadgeProgress);
router.get('/reputation-score', authMiddleware, BadgeController.getReputationScore);
router.post('/badge/check-upgrade', authMiddleware, BadgeController.checkBadgeUpgrade);

// Public endpoints
router.get('/badge/tier-config/:badgeLevel', BadgeController.getBadgeTierConfig);

// Admin endpoints
router.post('/admin/badge/approve-elite', authMiddleware, BadgeController.approveEliteBadge);

export default router;
