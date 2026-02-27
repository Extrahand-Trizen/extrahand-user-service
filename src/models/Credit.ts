import mongoose, { Schema, Model, Document } from 'mongoose';
import { CreditTransactionType } from '../types/referral';

export interface ICreditTransaction extends Document {
  transactionId?: string; // Optional for backward compatibility with legacy data
  type: CreditTransactionType;
  amount: number;
  description: string;
  relatedId?: mongoose.Types.ObjectId;
  status: 'completed' | 'pending' | 'failed';
  createdAt: Date;
  processedAt?: Date;
}

export interface ICredit extends Document {
  userId: mongoose.Types.ObjectId;
  balance: number;
  totalEarned: number;
  totalUsed: number;
  totalWithdrawn: number;
  transactions: ICreditTransaction[];
  createdAt: Date;
  updatedAt: Date;
}

const creditTransactionSchema = new Schema<ICreditTransaction>({
  transactionId: {
    type: String,
    required: false, // Allow null for legacy data
    sparse: true,   // Sparse index - ignore null values
    index: true
  },
  type: {
    type: String,
    enum: Object.values(CreditTransactionType),
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  relatedId: Schema.Types.ObjectId,
  status: {
    type: String,
    enum: ['completed', 'pending', 'failed'],
    default: 'pending'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  processedAt: Date
});

const creditSchema = new Schema<ICredit>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'Profile',
    required: true,
    unique: true,
    index: true
  },
  balance: {
    type: Number,
    default: 0,
    min: 0
  },
  totalEarned: {
    type: Number,
    default: 0
  },
  totalUsed: {
    type: Number,
    default: 0
  },
  totalWithdrawn: {
    type: Number,
    default: 0
  },
  transactions: [creditTransactionSchema],
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

export const Credit: Model<ICredit> = mongoose.model<ICredit>(
  'Credit',
  creditSchema
);
