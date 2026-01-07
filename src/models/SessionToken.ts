import { Schema, model, Document } from 'mongoose';

export type ClientType = 'web' | 'mobile';

export interface ISessionToken extends Document {
  sessionId: string;
  userId: string;
  tokenId: string;
  clientType: ClientType;
  refreshTokenHash: string;
  expiresAt: Date;
  createdAt: Date;
  revokedAt?: Date;
  revokedReason?: string;
  replacedByTokenId?: string;
  ipAddress?: string;
  userAgent?: string;
  deviceId?: string;
  lastUsedAt?: Date;
}

const SessionTokenSchema = new Schema<ISessionToken>(
  {
    sessionId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    tokenId: { type: String, required: true },
    clientType: { type: String, enum: ['web', 'mobile'], required: true },
    refreshTokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date },
    revokedReason: { type: String },
    replacedByTokenId: { type: String },
    ipAddress: { type: String },
    userAgent: { type: String },
    deviceId: { type: String },
    lastUsedAt: { type: Date },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'session_tokens',
  }
);

SessionTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default model<ISessionToken>('SessionToken', SessionTokenSchema);
