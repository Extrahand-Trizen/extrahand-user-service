import logger from '../../config/logger';
import { RewardProgram } from '../models/RewardProgram';
import type { RewardProgramDocument } from '../types/RewardProgram';
import {
  getDefaultPosterRewardProgramV1,
  getDefaultTaskerRewardProgramV1,
} from './defaultRewardProgramV1';
import { RewardConfigProvider } from '../config/RewardConfigProvider';
import { CoinUsageConfigProvider } from '../config/CoinUsageConfigProvider';

function referralConfigDiffers(
  existing: RewardProgramDocument['referral'] | undefined,
  target: RewardProgramDocument['referral'],
): boolean {
  if (!existing) return true;
  return JSON.stringify(existing) !== JSON.stringify(target);
}

export async function seedRewardProgramIfNeeded(): Promise<void> {
  const defaults = [getDefaultPosterRewardProgramV1(), getDefaultTaskerRewardProgramV1()];

  for (const doc of defaults) {
    const existing = await RewardProgram.findOne({
      programId: doc.programId,
      status: 'active',
    });

    if (!existing) {
      await RewardProgram.create(doc);
      logger.info('[rewards] Seeded RewardProgram', { programId: doc.programId, version: doc.version });
      continue;
    }

    const targetCoinValue = doc.coinEconomics.coinValueInr;
    const currentCoinValue = existing.coinEconomics?.coinValueInr;
    const updates: Record<string, unknown> = {};

    if (currentCoinValue !== targetCoinValue) {
      updates['coinEconomics.coinValueInr'] = targetCoinValue;
    }

    if (doc.coinUsage && !existing.coinUsage) {
      updates.coinUsage = doc.coinUsage;
    }

    if (referralConfigDiffers(existing.referral as RewardProgramDocument['referral'], doc.referral)) {
      updates.referral = doc.referral;
    }

    if (Object.keys(updates).length > 0) {
      await RewardProgram.updateOne({ _id: existing._id }, { $set: updates });
      logger.info('[rewards] Updated active RewardProgram fields', {
        programId: existing.programId,
        fields: Object.keys(updates),
        qualificationMode: doc.referral.qualificationMode,
      });
    }
  }

  RewardConfigProvider.invalidateCache();
  CoinUsageConfigProvider.invalidateCache();
}
