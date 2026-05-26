import { RewardProgram } from '../models/RewardProgram';
import type { RewardProgramDocument, RewardProgramSnapshot } from '../types/RewardProgram';
import { getDefaultRewardProgramV1 } from '../seed/defaultRewardProgramV1';

const CACHE_TTL_MS = 5 * 60 * 1000;

let cached: RewardProgramSnapshot | null = null;
let cacheAt = 0;

/**
 * Active reward program (Mongo + in-memory TTL). Swap implementation for Redis later.
 */
export class RewardConfigProvider {
  static async getActiveProgram(): Promise<RewardProgramSnapshot> {
    const now = Date.now();
    if (cached && now - cacheAt < CACHE_TTL_MS) {
      return cached;
    }

    const row = await RewardProgram.findOne({ status: 'active' })
      .sort({ version: -1 })
      .lean();

    if (row) {
      cached = row as RewardProgramSnapshot;
      cacheAt = now;
      return cached;
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
  }
}
