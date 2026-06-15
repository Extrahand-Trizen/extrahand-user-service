import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface IPartnerServiceArea extends Document {
  profileId: Types.ObjectId;
  uid: string;
  capabilityId?: Types.ObjectId;
  city: string;
  localities: string[];
  pinCodes: string[];
  radiusKm?: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const PartnerServiceAreaSchema = new Schema<IPartnerServiceArea>(
  {
    profileId: { type: Schema.Types.ObjectId, ref: 'Profile', required: true, index: true },
    uid: { type: String, required: true, index: true },
    capabilityId: { type: Schema.Types.ObjectId, ref: 'PartnerCapability' },
    city: { type: String, required: true },
    localities: { type: [String], default: [] },
    pinCodes: { type: [String], default: [], index: true },
    radiusKm: Number,
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

PartnerServiceAreaSchema.index({ pinCodes: 1, isActive: 1 });

const PartnerServiceArea: Model<IPartnerServiceArea> =
  mongoose.models.PartnerServiceArea ||
  mongoose.model<IPartnerServiceArea>('PartnerServiceArea', PartnerServiceAreaSchema);

export default PartnerServiceArea;
