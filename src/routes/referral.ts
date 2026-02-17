import express, { Router } from 'express';
import { ReferralController } from '../controllers/ReferralController';
import { authMiddleware } from '../middleware/auth';

const router: Router = express.Router();

// User referral endpoints (authenticated)
router.get('/referral-code', authMiddleware, ReferralController.getUserReferralCode);
router.get('/referral-dashboard', authMiddleware, ReferralController.getReferralDashboard);

// Credit management endpoints (authenticated)
router.get('/credits/balance', authMiddleware, ReferralController.getCreditBalance);
router.get('/credits/transactions', authMiddleware, ReferralController.getTransactionHistory);
router.post('/credits/use-payment', authMiddleware, ReferralController.useCredit);
router.post('/credits/gift', authMiddleware, ReferralController.giftCredit);

// Service-to-service endpoints (no auth middleware, uses x-service-token header)
router.post('/referral/qualify', ReferralController.qualifyReferral);

export default router;
