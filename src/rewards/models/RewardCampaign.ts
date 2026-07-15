import mongoose, { Schema, Model, Document } from 'mongoose';

export interface IRewardCampaign extends Document {
  campaignId: string;
  status: 'draft' | 'active' | 'archived';
  windowStart: Date;
  windowEnd: Date;
  appliesToProgramIds: string[];
  grantMultiplier?: number;
  extraGrants?: Array<{
    grantId: string;
    recipient: 'referrer' | 'referee';
    trigger: 'on_enroll' | 'on_qualify';
    amount: { type: 'fixed_coins' | 'fixed_inr'; value: number };
  }>;
}

const rewardCampaignSchema = new Schema<IRewardCampaign>(
  {
    campaignId: { type: String, required: true, unique: true },
    status: { type: String, enum: ['draft', 'active', 'archived'], default: 'draft', index: true },
    windowStart: { type: Date, required: true },
    windowEnd: { type: Date, required: true },
    appliesToProgramIds: [{ type: String }],
    grantMultiplier: Number,
    extraGrants: [Schema.Types.Mixed],
  },
  { timestamps: true }
);

export const RewardCampaign: Model<IRewardCampaign> = mongoose.model<IRewardCampaign>(
  'RewardCampaign',
  rewardCampaignSchema
);
