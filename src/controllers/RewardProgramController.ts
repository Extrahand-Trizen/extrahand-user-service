import { Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { RewardConfigProvider } from '../rewards/config/RewardConfigProvider';

export class RewardProgramController {
  /**
   * GET /api/v1/user/referral-program
   * Public marketing numbers from active RewardProgram.
   */
  static async getReferralProgram(_req: AuthenticatedRequest, res: Response): Promise<void> {
    const program = await RewardConfigProvider.getActiveProgram();
    const coinValue = program.coinEconomics.coinValueInr;
    const onEnroll = program.referral.grants.onEnroll || [];

    const referrerRule = onEnroll.find((r) => r.recipient === 'referrer');
    const refereeRule = onEnroll.find((r) => r.recipient === 'referee');

    const referrerCoins =
      referrerRule?.amount.type === 'fixed_coins' ? referrerRule.amount.value : 0;
    const refereeCoins =
      refereeRule?.amount.type === 'fixed_coins' ? refereeRule.amount.value : 0;

    res.json({
      success: true,
      data: {
        programId: program.programId,
        version: program.version,
        coinValueInr: coinValue,
        displayName: program.coinEconomics.displayName || 'ExtraCoins',
        qualificationMode: program.referral.qualificationMode,
        qualificationWindowDays: program.referral.qualificationWindowDays,
        referrerCoins,
        refereeCoins,
        referrerRupees: referrerCoins * coinValue,
        refereeRupees: refereeCoins * coinValue,
      },
    });
  }
}
