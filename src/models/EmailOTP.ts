import mongoose, { Schema, Model, Document } from 'mongoose';

export interface IEmailOTP extends Document {
  uid: string;
  email: string;
  otp: string; // Hashed OTP
  expiresAt: Date;
  verified: boolean;
  attempts: number;
  createdAt?: Date;
  updatedAt?: Date;
}

const EmailOTPSchema = new Schema<IEmailOTP>({
  uid: {
    type: String,
    required: true,
    index: true
  },
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true
  },
  otp: {
    type: String,
    required: true
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true // For TTL index
  },
  verified: {
    type: Boolean,
    default: false
  },
  attempts: {
    type: Number,
    default: 0,
    max: 3
  }
}, {
  timestamps: true
});

// TTL index - automatically delete documents 10 minutes after expiry
EmailOTPSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 600 });

// Compound index for efficient queries
EmailOTPSchema.index({ uid: 1, verified: 1, expiresAt: 1 });

const EmailOTP: Model<IEmailOTP> = mongoose.model<IEmailOTP>('EmailOTP', EmailOTPSchema);

export default EmailOTP;
