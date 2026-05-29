import { Response } from 'express';

import { AuthenticatedRequest } from '../types';

import { RewardConfigProvider } from '../rewards/config/RewardConfigProvider';

import { parseReferralChannel } from '../rewards/utils/walletRole';



export class RewardProgramController {

  /**

   * GET /api/v1/user/referral-program

   * Public marketing numbers from active RewardProgram.

   */

  static async getReferralProgram(req: AuthenticatedRequest, res: Response): Promise<void> {

    const referralChannel = parseReferralChannel(req.query?.referralChannel);

    const program = await RewardConfigProvider.getProgramByReferralChannel(referralChannel);

    const coinValue = program.coinEconomics.coinValueInr;

    const onEnroll = program.referral.grants.onEnroll || [];
    const onQualify = program.referral.grants.onQualify || [];

    const coinsFromRule = (rule?: { amount: { type: string; value: number } }) =>
      rule?.amount.type === 'fixed_coins' ? rule.amount.value : 0;

    const referrerEnrollRule = onEnroll.find((r) => r.recipient === 'referrer');
    const refereeEnrollRule = onEnroll.find((r) => r.recipient === 'referee');
    const referrerQualifyRule = onQualify.find((r) => r.recipient === 'referrer');
    const refereeQualifyRule = onQualify.find((r) => r.recipient === 'referee');

    const referrerEnrollCoins = coinsFromRule(referrerEnrollRule);
    const refereeEnrollCoins = coinsFromRule(refereeEnrollRule);
    const referrerQualifyCoins = coinsFromRule(referrerQualifyRule);
    const refereeQualifyCoins = coinsFromRule(refereeQualifyRule);

    /** Marketing tiles: best amount per role across enroll + qualify triggers */
    const referrerDisplayCoins = Math.max(referrerEnrollCoins, referrerQualifyCoins);
    const refereeDisplayCoins = Math.max(refereeEnrollCoins, refereeQualifyCoins);

    /** @deprecated use referrerEnrollCoins / referrerQualifyCoins */
    const referrerCoins = referrerDisplayCoins;
    const refereeCoins = refereeDisplayCoins;



    res.json({

      success: true,

      data: {

        programId: program.programId,

        version: program.version,

        coinValueInr: coinValue,

        displayName: program.coinEconomics.displayName || 'ExtraCoins',

        qualificationMode: program.referral.qualificationMode,

        qualificationWindowDays: program.referral.qualificationWindowDays,

        referralChannel,

        referrerCoins,

        refereeCoins,

        referrerEnrollCoins,

        refereeEnrollCoins,

        referrerQualifyCoins,

        refereeQualifyCoins,

        referrerDisplayCoins,

        refereeDisplayCoins,

        minQualifyingTaskAmountInr: program.referral.minQualifyingTaskAmountInr ?? 0,

        referrerRupees: referrerCoins * coinValue,

        refereeRupees: refereeCoins * coinValue,

        coinUsage: program.coinUsage,

      },

    });

  }

}

