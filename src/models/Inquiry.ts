import mongoose, { Document, Model, Schema } from 'mongoose';

export type InquiryPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface IInquiry extends Document {
  uid: string;
  fullName: string;
  email: string;
  subject: string;
  priority: InquiryPriority;
  message: string;
  source?: string;
  createdAt: Date;
  updatedAt: Date;
}

const inquirySchema = new Schema<IInquiry>(
  {
    uid: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    fullName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
    },
    subject: {
      type: String,
      required: true,
      trim: true,
      maxlength: 160,
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'urgent'],
      default: 'medium',
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 5000,
    },
    source: {
      type: String,
      trim: true,
      maxlength: 120,
    },
  },
  {
    timestamps: true,
    collection: 'inquiries',
  }
);

inquirySchema.index({ uid: 1, createdAt: -1 });
inquirySchema.index({ email: 1, createdAt: -1 });

const Inquiry: Model<IInquiry> = mongoose.model<IInquiry>('Inquiry', inquirySchema);

export default Inquiry;
