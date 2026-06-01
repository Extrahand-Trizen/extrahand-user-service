import type { CoinUsageConfig } from '../types/RewardProgram';
import { RewardConfigProvider } from './RewardConfigProvider';

const DEFAULT_POSTER_BOOKING_CAP = 0.1;
const DEFAULT_TASKER_PLATFORM_FEE_CAP = 0.15;
const CACHE_TTL_MS = 5 * 60 * 1000;

export interface ResolvedCoinUsageConfig {
  poster: { redeemCapPercentOfBooking: number };
  tasker: { redeemCapPercentOfPlatformFee: number };
}

let cached: ResolvedCoinUsageConfig | null = null;
let cacheAt = 0;

function resolveFromPrograms(
  posterUsage: CoinUsageConfig | undefined,
  taskerUsage: CoinUsageConfig | undefined
): ResolvedCoinUsageConfig {
  return {
    poster: {
      redeemCapPercentOfBooking:
        posterUsage?.poster?.redeemCapPercentOfBooking ?? DEFAULT_POSTER_BOOKING_CAP,
    },
    tasker: {
      redeemCapPercentOfPlatformFee:
        taskerUsage?.tasker?.redeemCapPercentOfPlatformFee ?? DEFAULT_TASKER_PLATFORM_FEE_CAP,
    },
  };
}

/**
 * Merged coin redemption caps from active RewardProgram documents (Mongo-configurable).
 */
export class CoinUsageConfigProvider {
  static async getConfig(): Promise<ResolvedCoinUsageConfig> {
    const now = Date.now();
    if (cached && now - cacheAt < CACHE_TTL_MS) {
      return cached;
    }

    const [posterProgram, taskerProgram] = await Promise.all([
      RewardConfigProvider.getProgramByReferralChannel('poster'),
      RewardConfigProvider.getProgramByReferralChannel('tasker'),
    ]);

    cached = resolveFromPrograms(posterProgram.coinUsage, taskerProgram.coinUsage);
    cacheAt = now;
    return cached;
  }

  static invalidateCache(): void {
    cached = null;
    cacheAt = 0;
  }
}
