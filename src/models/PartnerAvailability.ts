import mongoose, { Schema, Document, Model, Types } from 'mongoose';
import type { AvailabilityStatus } from '../types/supply';

export interface IPartnerAvailability extends Document {
  profileId: Types.ObjectId;
  uid: string;
  isOnline: boolean;
  currentStatus: AvailabilityStatus;
  autoAccept: boolean;
  lastSeenAt: Date;
  lastToggledAt: Date;
  updatedAt: Date;
}

const PartnerAvailabilitySchema = new Schema<IPartnerAvailability>(
  {
    profileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true, unique: true },
    uid: { type: String, required: true, unique: true, index: true },
    isOnline: { type: Boolean, default: false, index: true },
    currentStatus: {
      type: String,
      enum: ['available', 'busy', 'offline'],
      default: 'offline',
      index: true,
    },
    autoAccept: { type: Boolean, default: false },
    lastSeenAt: { type: Date, default: Date.now },
    lastToggledAt: { type: Date, default: Date.now },
  },
  { timestamps: { createdAt: false, updatedAt: true } },
);

PartnerAvailabilitySchema.index({ isOnline: 1, currentStatus: 1 });

const PartnerAvailability: Model<IPartnerAvailability> =
  mongoose.models.PartnerAvailability ||
  mongoose.model<IPartnerAvailability>('PartnerAvailability', PartnerAvailabilitySchema);

export default PartnerAvailability;
