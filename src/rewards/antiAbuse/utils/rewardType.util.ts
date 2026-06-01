import type { ReferralConsumptionRewardType } from '../types/referralConsumption.types';
import type { ReferralChannel } from '../../utils/walletRole';

export function refereeWelcomeRewardType(
  channel?: ReferralChannel | 'customer'
): ReferralConsumptionRewardType {
  if (channel === 'poster' || channel === 'customer') {
    return 'referee_poster_welcome';
  }
  return 'referee_tasker_welcome';
}
