import { Request, Response } from 'express';
import NotificationPreferencesService, {
    NotificationChannel,
    NotificationCategory,
} from '../services/NotificationPreferencesService';
import logger from '../config/logger';

export interface AuthenticatedRequest extends Request {
    user?: {
        uid: string;
        email?: string;
        [key: string]: any;
    };
}

export class NotificationPreferencesController {
    /**
     * Get user's notification preferences
     * GET /api/v1/notification-preferences
     */
    static async getPreferences(req: AuthenticatedRequest, res: Response): Promise<Response | void> {
        try {
            const uid = req.user?.uid;

            if (!uid) {
                return res.status(401).json({
                    success: false,
                    error: 'Unauthorized',
                });
            }

            const preferences = await NotificationPreferencesService.getPreferences(uid);

            return res.json({
                success: true,
                data: preferences,
            });
        } catch (error: any) {
            logger.error('Error getting notification preferences', {
                uid: req.user?.uid,
                error: error.message,
            });

            return res.status(500).json({
                success: false,
                error: 'Failed to get notification preferences',
            });
        }
    }

    /**
     * Update user's notification preferences
     * PUT /api/v1/notification-preferences
     */
    static async updatePreferences(req: AuthenticatedRequest, res: Response): Promise<Response | void> {
        try {
            const uid = req.user?.uid;

            if (!uid) {
                return res.status(401).json({
                    success: false,
                    error: 'Unauthorized',
                });
            }

            const updates = req.body;

            const preferences = await NotificationPreferencesService.updatePreferences(uid, updates);

            return res.json({
                success: true,
                data: preferences,
                message: 'Notification preferences updated successfully',
            });
        } catch (error: any) {
            logger.error('Error updating notification preferences', {
                uid: req.user?.uid,
                error: error.message,
            });

            return res.status(500).json({
                success: false,
                error: 'Failed to update notification preferences',
            });
        }
    }

    /**
     * Check if a notification can be sent to a user
     * GET /api/v1/notification-preferences/:uid/can-send?channel=email&category=taskUpdates
     * For service-to-service calls
     */
    static async canSendNotification(req: Request, res: Response): Promise<void> {
        try {
            const { uid } = req.params;
            const { channel, category } = req.query;

            if (!uid || !channel || !category) {
                res.status(400).json({
                    success: false,
                    error: 'Missing required parameters: uid, channel, category',
                });
                return;
            }

            const canSend = await NotificationPreferencesService.canSendNotification(
                uid,
                channel as NotificationChannel,
                category as NotificationCategory
            );

            res.json({
                success: true,
                data: {
                    canSend,
                    uid,
                    channel,
                    category,
                },
            });
        } catch (error: any) {
            logger.error('Error checking notification permission', {
                uid: req.params.uid,
                channel: req.query.channel,
                category: req.query.category,
                error: error.message,
            });

            res.status(500).json({
                success: false,
                error: 'Failed to check notification permission',
            });
        }
    }

    /**
     * Batch check if notifications can be sent to multiple users
     * POST /api/v1/notification-preferences/can-send-batch
     * Body: { uids: string[], channel: string, category: string }
     * For service-to-service calls
     */
    static async canSendNotificationBatch(req: Request, res: Response): Promise<void> {
        try {
            const { uids, channel, category } = req.body;

            if (!uids || !Array.isArray(uids) || !channel || !category) {
                res.status(400).json({
                    success: false,
                    error: 'Missing required parameters: uids (array), channel, category',
                });
                return;
            }

            const results = await NotificationPreferencesService.canSendNotificationBatch(
                uids,
                channel as NotificationChannel,
                category as NotificationCategory
            );

            // Convert Map to object for JSON response
            const resultsObject: Record<string, boolean> = {};
            results.forEach((canSend, uid) => {
                resultsObject[uid] = canSend;
            });

            res.json({
                success: true,
                data: {
                    results: resultsObject,
                    channel,
                    category,
                    totalUsers: uids.length,
                    allowedCount: Array.from(results.values()).filter((v) => v).length,
                },
            });
        } catch (error: any) {
            logger.error('Error checking batch notification permissions', {
                channel: req.body.channel,
                category: req.body.category,
                error: error.message,
            });

            res.status(500).json({
                success: false,
                error: 'Failed to check batch notification permissions',
            });
        }
    }
}

export default NotificationPreferencesController;
