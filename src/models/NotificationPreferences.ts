import mongoose, { Schema, Model, Document } from 'mongoose';

export interface INotificationPreferences extends Document {
    uid: string;
    push: {
        enabled: boolean;
        taskUpdates: boolean;
        payments: boolean;
        promotions: boolean;
        system: boolean;
        taskReminders: boolean;
        keywordTaskAlerts: boolean;
        recommendedTaskAlerts: boolean;
    };
    email: {
        enabled: boolean;
        taskUpdates: boolean;
        payments: boolean;
        promotions: boolean;
        system: boolean;
        marketing: boolean;
        taskReminders: boolean;
        keywordTaskAlerts: boolean;
        recommendedTaskAlerts: boolean;
    };
    sms: {
        enabled: boolean;
        taskUpdates: boolean;
        payments: boolean;
    };
    whatsapp: {
        enabled: boolean;
        taskUpdates: boolean;
        payments: boolean;
        promotions: boolean;
        system: boolean;
        marketing: boolean;
        taskReminders: boolean;
        keywordTaskAlerts: boolean;
        recommendedTaskAlerts: boolean;
    };
    preferredChannel: 'email' | 'sms' | 'push' | 'whatsapp';
    frequency: {
        dailyDigest: boolean;
        quietHours: {
            enabled: boolean;
            start: string; // 24hr format "HH:mm"
            end: string; // 24hr format "HH:mm"
            timezone: string;
        };
        maxPerDay: number;
    };
    createdAt?: Date;
    updatedAt?: Date;
}

const NotificationPreferencesSchema = new Schema<INotificationPreferences>(
    {
        uid: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },
        push: {
            enabled: { type: Boolean, default: true },
            taskUpdates: { type: Boolean, default: true },
            payments: { type: Boolean, default: true },
            promotions: { type: Boolean, default: false },
            system: { type: Boolean, default: true },
            taskReminders: { type: Boolean, default: true },
            keywordTaskAlerts: { type: Boolean, default: true },
            recommendedTaskAlerts: { type: Boolean, default: true },
        },
        email: {
            enabled: { type: Boolean, default: true },
            taskUpdates: { type: Boolean, default: true },
            payments: { type: Boolean, default: true },
            promotions: { type: Boolean, default: false },
            system: { type: Boolean, default: true },
            marketing: { type: Boolean, default: false },
            taskReminders: { type: Boolean, default: true },
            keywordTaskAlerts: { type: Boolean, default: true },
            recommendedTaskAlerts: { type: Boolean, default: true },
        },
        sms: {
            enabled: { type: Boolean, default: true },
            taskUpdates: { type: Boolean, default: true },
            payments: { type: Boolean, default: true },
        },
        whatsapp: {
            enabled: { type: Boolean, default: true },
            taskUpdates: { type: Boolean, default: true },
            payments: { type: Boolean, default: true },
            promotions: { type: Boolean, default: true },
            system: { type: Boolean, default: true },
            marketing: { type: Boolean, default: true },
            taskReminders: { type: Boolean, default: true },
            keywordTaskAlerts: { type: Boolean, default: true },
            recommendedTaskAlerts: { type: Boolean, default: true },
        },
        preferredChannel: {
            type: String,
            enum: ['email', 'sms', 'push', 'whatsapp'],
            default: 'push',
        },
        frequency: {
            dailyDigest: { type: Boolean, default: false },
            quietHours: {
                enabled: { type: Boolean, default: false },
                start: { type: String, default: '22:00' },
                end: { type: String, default: '08:00' },
                timezone: { type: String, default: 'Asia/Kolkata' },
            },
            maxPerDay: { type: Number, default: 0 }, // 0 = unlimited
        },
    },
    {
        timestamps: true,
    }
);

// Index for fast lookups
NotificationPreferencesSchema.index({ uid: 1 });

const NotificationPreferences: Model<INotificationPreferences> = mongoose.model<INotificationPreferences>(
    'NotificationPreferences',
    NotificationPreferencesSchema
);

export default NotificationPreferences;
