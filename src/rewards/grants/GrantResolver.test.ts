import { GrantResolver } from './GrantResolver';
import { getDefaultRewardProgramV1 } from '../seed/defaultRewardProgramV1';

describe('GrantResolver', () => {
  it('resolves 100 coin signup grants for referrer and referee', async () => {
    const snapshot = getDefaultRewardProgramV1();
    const grants = await GrantResolver.resolve(snapshot, 'on_enroll', {
      enrollmentId: 'enr1',
      referrerUid: 'referrer-uid',
      refereeUid: 'referee-uid',
      referralCode: 'TEST1234',
    });

    expect(grants).toHaveLength(2);
    const referrer = grants.find((g) => g.metadata.source === 'referral_signup');
    const referee = grants.find((g) => g.metadata.source === 'referral_welcome');
    expect(referrer?.coins).toBe('100.00');
    expect(referee?.coins).toBe('100.00');
    expect(referrer?.idempotencyKey).toContain('referrer-uid');
  });
});
