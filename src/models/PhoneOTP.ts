import mongoose, { Schema, Model, Document } from 'mongoose';

export type PhoneOtpPurpose = 'alternate_add' | 'login';

export interface IPhoneOTP extends Document {
  uid: string;
  phone: string;
  purpose: PhoneOtpPurpose;
  otp: string;
  expiresAt: Date;
  verified: boolean;
  attempts: number;
  createdAt?: Date;
  updatedAt?: Date;
}

const PhoneOTPSchema = new Schema<IPhoneOTP>(
  {
    uid: {
      type: String,
      required: true,
      index: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    purpose: {
      type: String,
      enum: ['alternate_add', 'login'],
      required: true,
      index: true,
    },
    otp: {
      type: String,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    verified: {
      type: Boolean,
      default: false,
    },
    attempts: {
      type: Number,
      default: 0,
      max: 5,
    },
  },
  {
    timestamps: true,
  }
);

PhoneOTPSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 300 });
PhoneOTPSchema.index({ uid: 1, purpose: 1, verified: 1, expiresAt: 1 });
PhoneOTPSchema.index({ phone: 1, purpose: 1, verified: 1, expiresAt: 1 });

const PhoneOTP: Model<IPhoneOTP> = mongoose.model<IPhoneOTP>('PhoneOTP', PhoneOTPSchema);

export default PhoneOTP;
