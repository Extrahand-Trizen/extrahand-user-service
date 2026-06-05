import mongoose, { Schema, Document, Model } from 'mongoose';

export type LocationNotifyRequestStatus = 'active' | 'notified';

export interface ILocationNotifyRequest extends Document {
  userId: string;
  city: string;
  locality: string;
  coordinates: [number, number] | null;
  locationKey: string;
  status: LocationNotifyRequestStatus;
  createdAt: Date;
  notifiedAt: Date | null;
}

const locationNotifyRequestSchema = new Schema<ILocationNotifyRequest>(
  {
    userId: { type: String, required: true, index: true, trim: true },
    city: { type: String, required: true, trim: true },
    locality: { type: String, default: '', trim: true },
    coordinates: {
      type: [Number],
      default: null,
      validate: {
        validator(value: number[] | null) {
          if (value == null) return true;
          return (
            Array.isArray(value) &&
            value.length === 2 &&
            Number.isFinite(value[0]) &&
            Number.isFinite(value[1])
          );
        },
        message: 'coordinates must be [longitude, latitude]',
      },
    },
    locationKey: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ['active', 'notified'],
      default: 'active',
      index: true,
    },
    notifiedAt: { type: Date, default: null },
  },
  {
    collection: 'location_notify_requests',
    timestamps: { createdAt: true, updatedAt: false },
  },
);

locationNotifyRequestSchema.index(
  { userId: 1, locationKey: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'active' },
    name: 'unique_active_notify_per_user_location',
  },
);

locationNotifyRequestSchema.index({ status: 1, createdAt: 1 });

export const LocationNotifyRequest: Model<ILocationNotifyRequest> =
  mongoose.models.LocationNotifyRequest ||
  mongoose.model<ILocationNotifyRequest>('LocationNotifyRequest', locationNotifyRequestSchema);
