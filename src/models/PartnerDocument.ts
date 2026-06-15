import mongoose, { Schema, Document, Model, Types } from 'mongoose';
import type { DocumentVerificationStatus, PartnerDocumentType } from '../types/supply';

export interface IPartnerDocument extends Document {
  profileId: Types.ObjectId;
  uid: string;
  capabilityId?: Types.ObjectId;
  documentType: PartnerDocumentType;
  fileUrl: string;
  verificationStatus: DocumentVerificationStatus;
  verifiedAt?: Date;
  verifiedBy?: string;
  rejectionReason?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const PartnerDocumentSchema = new Schema<IPartnerDocument>(
  {
    profileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true, index: true },
    uid: { type: String, required: true, index: true },
    capabilityId: { type: Schema.Types.ObjectId, ref: 'PartnerCapability' },
    documentType: {
      type: String,
      enum: [
        'aadhaar',
        'pan',
        'dl',
        'rc',
        'insurance',
        'police_verification',
        'experience_letter',
        'portfolio',
        'certificate',
      ],
      required: true,
    },
    fileUrl: { type: String, required: true },
    verificationStatus: {
      type: String,
      enum: ['pending', 'verified', 'rejected'],
      default: 'pending',
      index: true,
    },
    verifiedAt: Date,
    verifiedBy: String,
    rejectionReason: String,
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

const PartnerDocument: Model<IPartnerDocument> =
  mongoose.models.PartnerDocument ||
  mongoose.model<IPartnerDocument>('PartnerDocument', PartnerDocumentSchema);

export default PartnerDocument;
