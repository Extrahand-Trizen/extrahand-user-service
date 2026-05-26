import mongoose, { Schema, Model, Document } from 'mongoose';
import type { RewardProgramDocument } from '../types/RewardProgram';

export interface IRewardProgram extends Document, RewardProgramDocument {}

const grantRuleSchema = new Schema(
  {
    grantId: { type: String, required: true },
    recipient: { type: String, enum: ['referrer', 'referee', 'performer'], required: true },
    trigger: { type: String, enum: ['on_enroll', 'on_qualify', 'on_task_payout'], required: true },
    amount: {
      type: { type: String, enum: ['fixed_coins', 'fixed_inr', 'percent_of_platform_fee'], required: true },
      value: { type: Number, required: true },
    },
  },
  { _id: false }
);

const rewardProgramSchema = new Schema<IRewardProgram>(
  {
    programId: { type: String, required: true, index: true },
    version: { type: Number, required: true },
    status: { type: String, enum: ['draft', 'active', 'archived'], default: 'draft', index: true },
    effectiveFrom: Date,
    effectiveTo: Date,
    coinEconomics: {
      coinValueInr: { type: Number, required: true },
      earnedExpiryDays: { type: Number, required: true },
      expiringSoonDays: { type: Number, required: true },
      displayName: String,
    },
    referral: {
      qualificationMode: {
        type: String,
        enum: ['AUTO', 'FIRST_TASK', 'FIRST_PAYMENT', 'KYC'],
        required: true,
      },
      qualificationWindowDays: { type: Number, required: true },
      minQualifyingTaskAmountInr: Number,
      grants: {
        onEnroll: [grantRuleSchema],
        onQualify: [grantRuleSchema],
      },
    },
    taskRewards: Schema.Types.Mixed,
  },
  { timestamps: true }
);

rewardProgramSchema.index({ programId: 1, version: -1 });
rewardProgramSchema.index({ status: 1, effectiveFrom: 1 });

export const RewardProgram: Model<IRewardProgram> = mongoose.model<IRewardProgram>(
  'RewardProgram',
  rewardProgramSchema
);
