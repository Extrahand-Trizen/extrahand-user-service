import mongoose, { Schema, Model, Document } from 'mongoose';
import { VerificationType } from '../types/badge';

export interface IVerificationRecord extends Document {
  userId: mongoose.Types.ObjectId;
  type: VerificationType;
  status: 'pending' | 'verified' | 'rejected' | 'expired';
  verifiedAt?: Date;
  expiresAt?: Date;
  documentId?: string;
  provider?: string;
  verifiedBy?: mongoose.Types.ObjectId;
  rejectionReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const verificationRecordSchema = new Schema<IVerificationRecord>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'Profile',
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: Object.values(VerificationType),
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'verified', 'rejected', 'expired'],
    default: 'pending'
  },
  verifiedAt: Date,
  expiresAt: Date,
  documentId: String,
  provider: {
    type: String,
    enum: ['digilocker', 'manual', 'twilio', 'email']
  },
  verifiedBy: {
    type: Schema.Types.ObjectId,
    ref: 'Profile'
  },
  rejectionReason: String,
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

verificationRecordSchema.index({ userId: 1, type: 1 }, { unique: true });

export const VerificationRecord: Model<IVerificationRecord> = mongoose.model<IVerificationRecord>(
  'VerificationRecord',
  verificationRecordSchema
);
