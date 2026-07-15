import { RewardProgram } from '../models/RewardProgram';
import type { RewardProgramDocument, RewardProgramSnapshot } from '../types/RewardProgram';
import {
  getDefaultPosterRewardProgramV1,
  getDefaultRewardProgramV1,
  getDefaultTaskerRewardProgramV1,
} from '../seed/defaultRewardProgramV1';
import type { ReferralChannel } from '../utils/walletRole';
import { parseReferralChannel } from '../utils/walletRole';
import { CoinUsageConfigProvider } from './CoinUsageConfigProvider';
import logger from '../../config/logger';

const CACHE_TTL_MS = 5 * 60 * 1000;

let cached: RewardProgramSnapshot | null = null;
let cacheAt = 0;
const channelCache: Partial<Record<ReferralChannel, RewardProgramSnapshot>> = {};
const channelCacheAt: Partial<Record<ReferralChannel, number>> = {};

const PROGRAM_IDS_BY_CHANNEL: Record<ReferralChannel, string[]> = {
  poster: ['referral_poster_v1', 'referral_customer_v1'],
  tasker: ['referral_tasker_v1'],
};

/**
 * Active reward program (Mongo + in-memory TTL). Swap implementation for Redis later.
 */
export class RewardConfigProvider {
  static async getProgramByReferralChannel(
    referralChannel: ReferralChannel | string
  ): Promise<RewardProgramSnapshot> {
    const channel = parseReferralChannel(referralChannel);
    const now = Date.now();
    const cachedValue = channelCache[channel];
    const cachedAtValue = channelCacheAt[channel] || 0;
    if (cachedValue && now - cachedAtValue < CACHE_TTL_MS) {
      return cachedValue;
    }

    const programIds = PROGRAM_IDS_BY_CHANNEL[channel];
    try {
      const row = await RewardProgram.findOne({ status: 'active', programId: { $in: programIds } })
        .sort({ version: -1 })
        .lean();
      if (row) {
        channelCache[channel] = row as RewardProgramSnapshot;
        channelCacheAt[channel] = now;
        return channelCache[channel] as RewardProgramSnapshot;
      }
    } catch (error) {
      logger.warn('[rewards] getProgramByReferralChannel fallback to defaults', {
        referralChannel: channel,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const fallback = channel === 'poster' ? getDefaultPosterRewardProgramV1() : getDefaultTaskerRewardProgramV1();
    channelCache[channel] = fallback;
    channelCacheAt[channel] = now;
    return fallback;
  }

  static async getActiveProgram(): Promise<RewardProgramSnapshot> {
    const now = Date.now();
    if (cached && now - cacheAt < CACHE_TTL_MS) {
      return cached;
    }

    try {
      const row = await RewardProgram.findOne({ status: 'active' })
        .sort({ version: -1 })
        .lean();

      if (row) {
        cached = row as RewardProgramSnapshot;
        cacheAt = now;
        return cached;
      }
    } catch (error) {
      logger.warn('[rewards] getActiveProgram fallback to defaults', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const fallback = getDefaultRewardProgramV1();
    cached = fallback;
    cacheAt = now;
    return fallback;
  }

  static snapshotFromProgram(program: RewardProgramDocument): RewardProgramSnapshot {
    return JSON.parse(JSON.stringify(program)) as RewardProgramSnapshot;
  }

  static invalidateCache(): void {
    cached = null;
    cacheAt = 0;
    delete channelCache.poster;
    delete channelCache.tasker;
    delete channelCacheAt.poster;
    delete channelCacheAt.tasker;
    CoinUsageConfigProvider.invalidateCache();
  }
}
