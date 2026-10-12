import mongoose, { Document, Schema } from 'mongoose';

export type PartnerCategoryRequestStatus = 'pending' | 'approved' | 'rejected';

export interface IPartnerCategoryRequest extends Document {
  profileId: mongoose.Types.ObjectId;
  requester: {
    uid: string;
    name?: string;
    email?: string;
    phone?: string;
  };
  requestedCategory: string;
  requestedSkills: string[];
  currentCategories: string[];
  workAreas: string[];
  city?: string;
  status: PartnerCategoryRequestStatus;
  reviewNotes?: string;
  reviewedBy?: string;
  reviewedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const PartnerCategoryRequestSchema = new Schema<IPartnerCategoryRequest>(
  {
    profileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true, index: true },
    requester: {
      uid: { type: String, required: true, index: true },
      name: String,
      email: String,
      phone: String,
    },
    requestedCategory: { type: String, required: true, index: true },
    requestedSkills: { type: [String], required: true, default: [] },
    currentCategories: { type: [String], default: [] },
    workAreas: { type: [String], default: [] },
    city: { type: String, index: true },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      required: true,
      index: true,
    },
    reviewNotes: String,
    reviewedBy: String,
    reviewedAt: Date,
  },
  { timestamps: true },
);

PartnerCategoryRequestSchema.index(
  { profileId: 1, requestedCategory: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' } },
);
PartnerCategoryRequestSchema.index({ status: 1, createdAt: -1 });

export default mongoose.models.PartnerCategoryRequest ||
  mongoose.model<IPartnerCategoryRequest>('PartnerCategoryRequest', PartnerCategoryRequestSchema);
