import express, { Router } from 'express';
import { ReferralController } from '../controllers/ReferralController';
import { RewardProgramController } from '../controllers/RewardProgramController';
import { RewardsInternalController } from '../controllers/RewardsInternalController';
import { authMiddleware } from '../middleware/auth';
import { serviceAuthMiddleware } from '../middleware/serviceAuth';

const router: Router = express.Router();

// User referral endpoints (authenticated)
router.get('/referral-code/preview', ReferralController.previewReferralCode);
router.get('/referral-code', authMiddleware, ReferralController.getUserReferralCode);
router.get('/referral-program', authMiddleware, RewardProgramController.getReferralProgram);
router.post('/referral/apply', authMiddleware, ReferralController.applyReferralCode);
router.post('/referral/retry-grants', authMiddleware, ReferralController.retryReferralGrants);
router.get('/referral-dashboard', authMiddleware, ReferralController.getReferralDashboard);

// Internal rewards (service-auth)
router.post(
  '/internal/rewards/process-event',
  serviceAuthMiddleware,
  RewardsInternalController.processEvent
);
router.get(
  '/internal/rewards/coin-usage',
  serviceAuthMiddleware,
  RewardsInternalController.getCoinUsage
);
router.get(
  '/internal/rewards/referral-debug',
  serviceAuthMiddleware,
  RewardsInternalController.getReferralDebug
);
router.post(
  '/internal/rewards/retry-grants',
  serviceAuthMiddleware,
  RewardsInternalController.retryGrantsInternal
);

// Credit management endpoints (authenticated)
router.get('/credits/balance', authMiddleware, ReferralController.getCreditBalance);
router.get('/credits/transactions', authMiddleware, ReferralController.getTransactionHistory);
router.post('/credits/use-payment', authMiddleware, ReferralController.useCredit);
router.post('/credits/gift', authMiddleware, ReferralController.giftCredit);
router.post('/credits/withdraw', authMiddleware, ReferralController.withdrawCredit);
router.get('/credits/withdrawals', authMiddleware, ReferralController.getWithdrawalHistory);

// Service-to-service endpoints (x-service-auth or legacy x-service-token)
router.post('/referral/qualify', serviceAuthMiddleware, ReferralController.qualifyReferral);

export default router;
