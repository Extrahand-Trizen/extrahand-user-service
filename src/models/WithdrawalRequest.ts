import mongoose, { Schema, Model, Document } from 'mongoose';

export interface IWithdrawalRequest extends Document {
  userId: mongoose.Types.ObjectId;
  amount: number;
  creditTransactionId: string;
  bankAccountId?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  utrNumber?: string;
  failureReason?: string;
  requestedAt: Date;
  processedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const withdrawalRequestSchema = new Schema<IWithdrawalRequest>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'Profile',
    required: true,
    index: true
  },
  amount: {
    type: Number,
    required: true,
    min: 500
  },
  creditTransactionId: {
    type: String,
    required: true
  },
  bankAccountId: {
    type: String
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
    default: 'pending',
    index: true
  },
  utrNumber: {
    type: String
  },
  failureReason: {
    type: String
  },
  requestedAt: {
    type: Date,
    default: Date.now
  },
  processedAt: {
    type: Date
  },
  completedAt: {
    type: Date
  }
}, {
  timestamps: true
});

// Indexes for efficient queries
withdrawalRequestSchema.index({ userId: 1, status: 1 });
withdrawalRequestSchema.index({ requestedAt: -1 });

export const WithdrawalRequest: Model<IWithdrawalRequest> = mongoose.model<IWithdrawalRequest>(
  'WithdrawalRequest',
  withdrawalRequestSchema
);
