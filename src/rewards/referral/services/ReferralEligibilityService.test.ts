import Profile from '../../../models/Profile';
import { ReferralRecord } from '../../../models/ReferralRecord';
import { ReferralConsumptionService } from '../../antiAbuse/services/ReferralConsumptionService';
import { ReferralEligibilityService } from './ReferralEligibilityService';

jest.mock('../../../models/Profile');
jest.mock('../../../models/ReferralRecord');
jest.mock('../../antiAbuse/services/ReferralConsumptionService');
jest.mock('../../antiAbuse/utils/phoneHash.util', () => ({
  hashReferralPhone: (phone?: string) => (phone ? `hash:${phone}` : null),
}));

const mockProfileFindOne = Profile.findOne as jest.Mock;
const mockReferralFindOne = ReferralRecord.findOne as jest.Mock;
const mockCheckRefereeWelcome = ReferralConsumptionService.checkRefereeWelcome as jest.Mock;

function chainLean<T>(value: T) {
  return { lean: jest.fn().mockResolvedValue(value) };
}

describe('ReferralEligibilityService.checkRefereeWelcomeEligibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRefereeWelcome.mockResolvedValue({ allowed: true, blocked: [] });
  });

  it('returns already_consumed from profile phone when enrollment is missing', async () => {
    mockProfileFindOne.mockReturnValue(
      chainLean({ _id: 'profile1', phone: '+917416337859' }),
    );
    mockReferralFindOne.mockReturnValue(chainLean(null));
    mockCheckRefereeWelcome.mockResolvedValue({
      allowed: false,
      blocked: [{ rewardType: 'referee_tasker_welcome', reason: 'already_consumed' }],
    });

    const result = await ReferralEligibilityService.checkRefereeWelcomeEligibility('uid-new');

    expect(result).toEqual({ eligible: false, reason: 'already_consumed' });
    expect(mockCheckRefereeWelcome).toHaveBeenCalledWith('hash:+917416337859', 'tasker');
  });

  it('returns no_enrollment when phone not consumed and no referral row', async () => {
    mockProfileFindOne.mockReturnValue(
      chainLean({ _id: 'profile1', phone: '+917416337859' }),
    );
    mockReferralFindOne.mockReturnValue(chainLean(null));

    const result = await ReferralEligibilityService.checkRefereeWelcomeEligibility('uid-new');

    expect(result).toEqual({ eligible: false, reason: 'no_enrollment' });
  });

  it('returns eligible when enrolled and phone not consumed', async () => {
    mockProfileFindOne.mockReturnValue(
      chainLean({ _id: 'profile1', phone: '+917416337859' }),
    );
    mockReferralFindOne.mockReturnValue(
      chainLean({
        referralChannel: 'tasker',
        referralCode: 'ABC123',
        refereePhoneHash: 'hash:+917416337859',
      }),
    );

    const result = await ReferralEligibilityService.checkRefereeWelcomeEligibility('uid-new');

    expect(result).toEqual({ eligible: true, referralCode: 'ABC123' });
  });
});
