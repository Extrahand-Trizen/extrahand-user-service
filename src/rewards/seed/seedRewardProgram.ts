import logger from '../../config/logger';
import { RewardProgram } from '../models/RewardProgram';
import { getDefaultRewardProgramV1 } from './defaultRewardProgramV1';
import { RewardConfigProvider } from '../config/RewardConfigProvider';

export async function seedRewardProgramIfNeeded(): Promise<void> {
  const existing = await RewardProgram.findOne({
    programId: 'referral_v1',
    status: 'active',
  });

  if (existing) {
    logger.info('[rewards] Active RewardProgram already present', {
      programId: existing.programId,
      version: existing.version,
    });
    return;
  }

  const doc = getDefaultRewardProgramV1();
  await RewardProgram.create(doc);
  RewardConfigProvider.invalidateCache();
  logger.info('[rewards] Seeded default RewardProgram v1 (AUTO, 100+100 coins)');
}
