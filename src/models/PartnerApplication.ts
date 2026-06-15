import mongoose, { Schema, Document, Model, Types } from 'mongoose';
import type { PartnerApplicationStatus } from '../types/supply';

export interface IPartnerApplication extends Document {
  profileId: Types.ObjectId;
  uid: string;
  status: PartnerApplicationStatus;
  capabilityIds: Types.ObjectId[];
  submittedAt?: Date;
  reviewedAt?: Date;
  reviewedBy?: string;
  reviewNotes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const PartnerApplicationSchema = new Schema<IPartnerApplication>(
  {
    profileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true, index: true },
    uid: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: ['draft', 'submitted', 'pending_review', 'approved', 'rejected'],
      default: 'draft',
      index: true,
    },
    capabilityIds: [{ type: Schema.Types.ObjectId, ref: 'PartnerCapability' }],
    submittedAt: Date,
    reviewedAt: Date,
    reviewedBy: String,
    reviewNotes: String,
  },
  { timestamps: true },
);

const PartnerApplication: Model<IPartnerApplication> =
  mongoose.models.PartnerApplication ||
  mongoose.model<IPartnerApplication>('PartnerApplication', PartnerApplicationSchema);

export default PartnerApplication;
