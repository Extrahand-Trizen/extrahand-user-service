import { Router } from 'express';
import { NotificationPreferencesController } from '../controllers/NotificationPreferencesController';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// Get user's notification preferences
router.get(
    '/',
    authMiddleware,
    NotificationPreferencesController.getPreferences
);

// Update user's notification preferences
router.put(
    '/',
    authMiddleware,
    NotificationPreferencesController.updatePreferences
);

// Check if notification can be sent (for service-to-service calls)
router.get(
    '/:uid/can-send',
    NotificationPreferencesController.canSendNotification
);

// Batch check if notifications can be sent (for service-to-service calls)
router.post(
    '/can-send-batch',
    NotificationPreferencesController.canSendNotificationBatch
);

export default router;
