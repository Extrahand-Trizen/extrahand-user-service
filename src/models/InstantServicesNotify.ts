import mongoose, { Schema, Document, Model } from 'mongoose';

export type InstantServicesNotifyStatus = 'active' | 'notified';

export interface IInstantServicesNotify extends Document {
  userId: string;
  status: InstantServicesNotifyStatus;
  createdAt: Date;
  notifiedAt: Date | null;
}

const instantServicesNotifySchema = new Schema<IInstantServicesNotify>(
  {
    userId: { type: String, required: true, index: true, trim: true },
    status: {
      type: String,
      enum: ['active', 'notified'],
      default: 'active',
      index: true,
    },
    notifiedAt: { type: Date, default: null },
  },
  {
    collection: 'instantservicesnotify',
    timestamps: { createdAt: true, updatedAt: false },
  },
);

instantServicesNotifySchema.index(
  { userId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'active' },
    name: 'unique_active_instant_services_notify_per_user',
  },
);

instantServicesNotifySchema.index({ status: 1, createdAt: 1 });

export const InstantServicesNotify: Model<IInstantServicesNotify> =
  mongoose.models.InstantServicesNotify ||
  mongoose.model<IInstantServicesNotify>('InstantServicesNotify', instantServicesNotifySchema);
