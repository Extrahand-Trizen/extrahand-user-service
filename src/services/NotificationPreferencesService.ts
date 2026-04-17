import NotificationPreferences, { INotificationPreferences } from '../models/NotificationPreferences';
import logger from '../config/logger';

export type NotificationCategory =
    | 'taskUpdates'
    | 'payments'
    | 'promotions'
    | 'reminders'
    | 'system'
    | 'marketing'
    | 'taskReminders'
    | 'keywordTaskAlerts'
    | 'recommendedTaskAlerts';
export type NotificationChannel = 'push' | 'email' | 'sms' | 'whatsapp';

export class NotificationPreferencesService {
    /**
     * Get notification preferences for a user
     * Creates default preferences if none exist
     */
    static async getPreferences(uid: string): Promise<INotificationPreferences> {
        try {
            let preferences = await NotificationPreferences.findOne({ uid });

            if (!preferences) {
                // Create default preferences
                preferences = await NotificationPreferences.create({ uid });
                logger.info('Created default notification preferences', { uid });
            }

            return preferences;
        } catch (error: any) {
            logger.error('Error getting notification preferences', {
                uid,
                error: error.message,
            });
            throw error;
        }
    }

    /**
     * Update notification preferences for a user
     */
    static async updatePreferences(
        uid: string,
        updates: Partial<INotificationPreferences>
    ): Promise<INotificationPreferences> {
        try {
            const preferences = await NotificationPreferences.findOneAndUpdate(
                { uid },
                { $set: updates },
                { new: true, upsert: true, runValidators: true }
            );

            if (!preferences) {
                throw new Error('Failed to update notification preferences');
            }

            logger.info('Updated notification preferences', {
                uid,
                updatedFields: Object.keys(updates),
            });

            return preferences;
        } catch (error: any) {
            logger.error('Error updating notification preferences', {
                uid,
                error: error.message,
            });
            throw error;
        }
    }

    /**
     * Check if a user can receive a notification on a specific channel for a specific category
     * This is the main method that should be called before sending any notification
     * 
     * @param uid - User ID
     * @param channel - Notification channel (push, email, sms)
     * @param category - Notification category (taskUpdates, payments, etc.)
     * @returns Promise<boolean> - true if notification can be sent, false otherwise
     */
    static async canSendNotification(
        uid: string,
        channel: NotificationChannel,
        category: NotificationCategory
    ): Promise<boolean> {
        try {
            const preferences = await this.getPreferences(uid);

            // Check if channel is enabled
            if (!preferences[channel].enabled) {
                logger.info('Notification blocked: channel disabled', {
                    uid,
                    channel,
                    category,
                });
                return false;
            }

            // Check if category is enabled for this channel
            const categoryEnabled = preferences[channel][category as keyof typeof preferences[typeof channel]];

            if (!categoryEnabled) {
                logger.info('Notification blocked: category disabled', {
                    uid,
                    channel,
                    category,
                });
                return false;
            }

            // Check quiet hours (only for non-system notifications)
            if (category !== 'system' && preferences.frequency.quietHours.enabled) {
                const isQuietHours = this.isWithinQuietHours(
                    preferences.frequency.quietHours.start,
                    preferences.frequency.quietHours.end,
                    preferences.frequency.quietHours.timezone
                );

                if (isQuietHours) {
                    logger.info('Notification blocked: quiet hours', {
                        uid,
                        channel,
                        category,
                        quietHours: preferences.frequency.quietHours,
                    });
                    return false;
                }
            }

            logger.info('Notification allowed', {
                uid,
                channel,
                category,
            });

            return true;
        } catch (error: any) {
            logger.error('Error checking notification permission', {
                uid,
                channel,
                category,
                error: error.message,
            });
            // Fail closed to avoid sending unwanted notifications when checks fail.
            return false;
        }
    }

    /**
     * Check if current time is within quiet hours
     */
    private static isWithinQuietHours(start: string, end: string, timezone: string): boolean {
        try {
            const now = new Date();
            const currentTime = now.toLocaleTimeString('en-US', {
                hour12: false,
                timeZone: timezone,
                hour: '2-digit',
                minute: '2-digit',
            });

            // Convert times to minutes for comparison
            const [startHour, startMin] = start.split(':').map(Number);
            const [endHour, endMin] = end.split(':').map(Number);
            const [currentHour, currentMin] = currentTime.split(':').map(Number);

            const startMinutes = startHour * 60 + startMin;
            const endMinutes = endHour * 60 + endMin;
            const currentMinutes = currentHour * 60 + currentMin;

            // Handle overnight quiet hours (e.g., 22:00 - 08:00)
            if (startMinutes > endMinutes) {
                return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
            }

            // Normal quiet hours (e.g., 14:00 - 16:00)
            return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
        } catch (error: any) {
            logger.error('Error checking quiet hours', {
                start,
                end,
                timezone,
                error: error.message,
            });
            return false; // On error, assume not in quiet hours
        }
    }

    /**
     * Batch check if notifications can be sent to multiple users
     * Useful for bulk notifications
     */
    static async canSendNotificationBatch(
        uids: string[],
        channel: NotificationChannel,
        category: NotificationCategory
    ): Promise<Map<string, boolean>> {
        const results = new Map<string, boolean>();

        await Promise.all(
            uids.map(async (uid) => {
                const canSend = await this.canSendNotification(uid, channel, category);
                results.set(uid, canSend);
            })
        );

        return results;
    }

    /**
     * Get users who can receive a specific notification
     * Filters out users who have disabled the channel or category
     */
    static async filterUsersForNotification(
        uids: string[],
        channel: NotificationChannel,
        category: NotificationCategory
    ): Promise<string[]> {
        const results = await this.canSendNotificationBatch(uids, channel, category);
        return uids.filter((uid) => results.get(uid) === true);
    }
}

export default NotificationPreferencesService;
