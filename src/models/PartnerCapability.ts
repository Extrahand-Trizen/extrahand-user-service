import mongoose, { Schema, Document, Model, Types } from 'mongoose';
import type { CapabilityStatus, CapabilityType } from '../types/supply';

export interface IPartnerCapability extends Document {
  profileId: Types.ObjectId;
  uid: string;
  capabilityType: CapabilityType;
  categorySlug: string;
  status: CapabilityStatus;
  documents: Types.ObjectId[];
  metadata: Record<string, unknown>;
  approvedAt?: Date;
  approvedBy?: string;
  rejectionReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const PartnerCapabilitySchema = new Schema<IPartnerCapability>(
  {
    profileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true, index: true },
    uid: { type: String, required: true, index: true },
    capabilityType: {
      type: String,
      enum: ['field_service', 'delivery', 'driver', 'mover', 'remote_service'],
      required: true,
    },
    categorySlug: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'suspended'],
      default: 'pending',
      index: true,
    },
    documents: [{ type: Schema.Types.ObjectId, ref: 'PartnerDocument' }],
    metadata: { type: Schema.Types.Mixed, default: {} },
    approvedAt: Date,
    approvedBy: String,
    rejectionReason: String,
  },
  { timestamps: true },
);

PartnerCapabilitySchema.index(
  { profileId: 1, capabilityType: 1, categorySlug: 1 },
  { unique: true },
);
PartnerCapabilitySchema.index({ status: 1, capabilityType: 1, categorySlug: 1 });

const PartnerCapability: Model<IPartnerCapability> =
  mongoose.models.PartnerCapability ||
  mongoose.model<IPartnerCapability>('PartnerCapability', PartnerCapabilitySchema);

export default PartnerCapability;
