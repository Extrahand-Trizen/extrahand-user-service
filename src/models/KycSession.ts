import mongoose, { Model, Schema } from 'mongoose';

export interface IKycSession {
  _id: mongoose.Types.ObjectId;
  verification_id?: string;
  userId: string;
  sessionType?: string;
  status?: boolean | string;
  internalStatus?: string;
  visibleStatus?: string;
  failureReason?: string;
  visibleFailureAt?: Date | string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

const kycSessionSchema = new Schema<IKycSession>(
  {
    verification_id: String,
    userId: {
      type: String,
      required: true,
      index: true,
    },
    sessionType: {
      type: String,
      index: true,
    },
    status: Schema.Types.Mixed,
    internalStatus: String,
    visibleStatus: String,
    failureReason: String,
    visibleFailureAt: Date,
    createdAt: Date,
    updatedAt: Date,
  },
  {
    collection: 'kycsessions',
    strict: false,
  }
);

export function getKycSessionModel(): Model<IKycSession> {
  const dbName =
    process.env.KYC_VERIFICATION_DB ||
    process.env.VERIFICATION_MONGODB_DB ||
    'extrahand_verifications';
  const connection = mongoose.connection.useDb(dbName, { useCache: true });

  return (
    (connection.models.KycSession as Model<IKycSession> | undefined) ||
    connection.model<IKycSession>('KycSession', kycSessionSchema)
  );
}
