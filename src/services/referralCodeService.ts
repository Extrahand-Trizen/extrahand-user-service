import mongoose from 'mongoose';
import { ReferralCode, type IReferralCode } from '../models/ReferralCode';
import { ReferralService } from './referralService';
import type { ReferralChannel } from '../rewards/utils/walletRole';
import logger from '../config/logger';

const MAX_CODE_ATTEMPTS = 12;

export type DualReferralCodes = {
  poster: IReferralCode;
  tasker: IReferralCode;
};

async function createUniqueCodeForChannel(
  userId: mongoose.Types.ObjectId,
  name: string,
  channel: ReferralChannel
): Promise<IReferralCode> {
  const existing = await ReferralCode.findOne({ userId, channel });
  if (existing) {
    return existing;
  }

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = ReferralService.generateReferralCode(name);
    try {
      return (await ReferralCode.create({ code, userId, channel })) as IReferralCode;
    } catch (err: unknown) {
      const mongoErr = err as {
        code?: number;
        keyPattern?: Record<string, number>;
        keyValue?: Record<string, unknown>;
      };
      if (mongoErr?.code === 11000) {
        const pattern = mongoErr.keyPattern || {};
        if (pattern.userId === 1 && pattern.channel === 1) {
          const current = await ReferralCode.findOne({ userId, channel });
          if (current) return current;
        }

        if (pattern.userId === 1 && pattern.channel !== 1) {
          throw new Error(
            'ReferralCode legacy unique index on userId is blocking dual codes. Run migrate-referral-codes-dual-channel.ts --execute'
          );
        }
        continue;
      }
      throw err;
    }
  }
  throw new Error(`Failed to generate unique referral code for channel ${channel}`);
}

/**
 * Ensure each user has one poster and one tasker referral code.
 */
export async function ensureDualReferralCodes(
  userId: mongoose.Types.ObjectId,
  name: string
): Promise<DualReferralCodes> {
  const displayName = name?.trim() || 'User';
  let poster: IReferralCode | null = await ReferralCode.findOne({ userId, channel: 'poster' });
  let tasker: IReferralCode | null = await ReferralCode.findOne({ userId, channel: 'tasker' });

  if (poster && !ReferralService.isValidReferralCode(poster.code)) {
    await ReferralCode.deleteOne({ _id: poster._id });
    poster = null;
  }
  if (tasker && !ReferralService.isValidReferralCode(tasker.code)) {
    await ReferralCode.deleteOne({ _id: tasker._id });
    tasker = null;
  }

  if (!poster) {
    const legacy = await ReferralCode.findOne({ userId, channel: { $exists: false } } as Record<string, unknown>);
    if (legacy) {
      legacy.channel = 'poster';
      await legacy.save();
      poster = legacy;
      logger.info('[referralCode] Migrated legacy code to poster channel', { userId: String(userId) });
    }
  }

  if (!poster) {
    poster = await createUniqueCodeForChannel(userId, displayName, 'poster');
  }
  if (!tasker) {
    tasker = await createUniqueCodeForChannel(userId, displayName, 'tasker');
  }

  if (!poster || !tasker) {
    throw new Error('Failed to ensure dual referral codes');
  }

  return { poster, tasker };
}

export async function lookupReferralCodeChannel(code: string): Promise<{
  valid: boolean;
  channel?: ReferralChannel;
  code?: string;
}> {
  const normalized = code.trim().toUpperCase();
  if (!ReferralService.isValidReferralCode(normalized)) {
    return { valid: false };
  }
  const row = await ReferralCode.findOne({ code: normalized }).lean();
  if (!row?.channel) {
    return { valid: false };
  }
  return { valid: true, channel: row.channel as ReferralChannel, code: normalized };
}
