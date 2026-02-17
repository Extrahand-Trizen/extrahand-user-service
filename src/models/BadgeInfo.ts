import mongoose, { Schema, Model, Document } from 'mongoose';
import { BadgeLevel } from '../types/badge';

export interface IBadgeHistoryEntry extends Document {
  badge: BadgeLevel;
  achievedAt: Date;
  reason: string;
  reputationScoreAtTime: number;
}

export interface IBadgeInfo extends Document {
  userId: mongoose.Types.ObjectId;
  currentBadge: BadgeLevel;
  previousBadge?: BadgeLevel;
  badgeUpgradedAt?: Date;
  badgeHistory: IBadgeHistoryEntry[];
  lastBadgeCheckAt: Date;
  eliteApprovedBy?: mongoose.Types.ObjectId;
  eliteApprovedAt?: Date;
  eliteRejectionReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const badgeHistorySchema = new Schema<IBadgeHistoryEntry>({
  badge: {
    type: String,
    enum: Object.values(BadgeLevel),
    required: true
  },
  achievedAt: {
    type: Date,
    default: Date.now
  },
  reason: {
    type: String,
    required: true
  },
  reputationScoreAtTime: {
    type: Number,
    default: 0
  }
});

const badgeInfoSchema = new Schema<IBadgeInfo>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'Profile',
    required: true,
    unique: true,
    index: true
  },
  currentBadge: {
    type: String,
    enum: Object.values(BadgeLevel),
    default: BadgeLevel.NONE
  },
  previousBadge: {
    type: String,
    enum: Object.values(BadgeLevel)
  },
  badgeUpgradedAt: Date,
  badgeHistory: [badgeHistorySchema],
  lastBadgeCheckAt: {
    type: Date,
    default: Date.now
  },
  eliteApprovedBy: {
    type: Schema.Types.ObjectId,
    ref: 'Profile'
  },
  eliteApprovedAt: Date,
  eliteRejectionReason: String,
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

export const BadgeInfo: Model<IBadgeInfo> = mongoose.model<IBadgeInfo>(
  'BadgeInfo',
  badgeInfoSchema
);
