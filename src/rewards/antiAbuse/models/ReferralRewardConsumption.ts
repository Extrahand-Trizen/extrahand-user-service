import mongoose, { Schema, Model, Document } from 'mongoose';
import type { ReferralConsumptionRewardType } from '../types/referralConsumption.types';

export interface IReferralRewardConsumption extends Document {
  phoneHash: string;
  rewardType: ReferralConsumptionRewardType;
  firstRewardedAt: Date;
  firstReferrerId?: string;
  firstEnrollmentId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<IReferralRewardConsumption>(
  {
    phoneHash: { type: String, required: true, index: true },
    rewardType: { type: String, required: true, index: true },
    firstRewardedAt: { type: Date, required: true, default: Date.now },
    firstReferrerId: { type: String },
    firstEnrollmentId: { type: String },
  },
  { timestamps: true }
);

schema.index({ phoneHash: 1, rewardType: 1 }, { unique: true });

export const ReferralRewardConsumption: Model<IReferralRewardConsumption> =
  mongoose.model<IReferralRewardConsumption>('ReferralRewardConsumption', schema);
