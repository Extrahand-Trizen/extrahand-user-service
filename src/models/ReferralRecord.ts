import mongoose, { Schema, Model, Document } from 'mongoose';
import { ReferralStatus } from '../types/referral';

export interface IReferralRecord extends Document {
  referrerId: mongoose.Types.ObjectId;
  refereeId: mongoose.Types.ObjectId;
  /** Firebase uid — canonical external id */
  referrerUid?: string;
  refereeUid?: string;
  referralCode: string;
  status: ReferralStatus;
  createdAt: Date;
  appliedAt?: Date;
  qualifiedDate?: Date;
  rewardProgramSnapshot?: Record<string, unknown>;
  qualifyingTaskId?: mongoose.Types.ObjectId;
  expiresAt: Date;
  referrerRewardAmount: number;
  refereeRewardAmount: number;
  referrerRewardCredited?: Date;
  refereeRewardCredited?: Date;
  updatedAt: Date;
}

const referralRecordSchema = new Schema<IReferralRecord>({
  referrerId: {
    type: Schema.Types.ObjectId,
    ref: 'Profile',
    required: true,
    index: true
  },
  refereeId: {
    type: Schema.Types.ObjectId,
    ref: 'Profile',
    required: true,
    index: true
  },
  referrerUid: {
    type: String,
    index: true,
  },
  refereeUid: {
    type: String,
    index: true,
  },
  appliedAt: Date,
  rewardProgramSnapshot: Schema.Types.Mixed,
  referralCode: {
    type: String,
    required: true,
    uppercase: true
  },
  status: {
    type: String,
    enum: Object.values(ReferralStatus),
    default: ReferralStatus.PENDING,
    index: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  qualifiedDate: Date,
  qualifyingTaskId: {
    type: Schema.Types.ObjectId,
    ref: 'Task'
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true
  },
  referrerRewardAmount: {
    type: Number,
    default: 100
  },
  refereeRewardAmount: {
    type: Number,
    default: 50
  },
  referrerRewardCredited: Date,
  refereeRewardCredited: Date,
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

referralRecordSchema.index({ referrerId: 1, refereeId: 1 }, { unique: true });

export const ReferralRecord: Model<IReferralRecord> = mongoose.model<IReferralRecord>(
  'ReferralRecord',
  referralRecordSchema
);
