import mongoose, { Schema, Model, Document } from 'mongoose';

export interface IReferralCode extends Document {
  code: string;
  userId: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const referralCodeSchema = new Schema<IReferralCode>({
  code: {
    type: String,
    required: true,
    unique: true,
    index: true,
    uppercase: true,
    match: /^[A-Z]{4}[A-Z0-9]{4}$/
  },
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'Profile',
    required: true,
    unique: true,
    index: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

export const ReferralCode: Model<IReferralCode> = mongoose.model<IReferralCode>(
  'ReferralCode',
  referralCodeSchema
);
