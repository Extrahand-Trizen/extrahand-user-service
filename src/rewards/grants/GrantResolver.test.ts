import { GrantResolver } from './GrantResolver';
import {
  getDefaultPosterRewardProgramV1,
  getDefaultRewardProgramV1,
} from '../seed/defaultRewardProgramV1';

describe('GrantResolver', () => {
  it('resolves 100 coin signup grants for referrer and referee (tasker AUTO)', async () => {
    const snapshot = getDefaultRewardProgramV1();
    const grants = await GrantResolver.resolve(snapshot, 'on_enroll', {
      enrollmentId: 'enr1',
      referrerUid: 'referrer-uid',
      refereeUid: 'referee-uid',
      referralCode: 'TEST1234',
      referralChannel: 'tasker',
    });

    expect(grants).toHaveLength(2);
    const referrer = grants.find((g) => g.metadata.source === 'referral_signup');
    const referee = grants.find((g) => g.metadata.source === 'referral_welcome');
    expect(referrer?.coins).toBe('100.00');
    expect(referee?.coins).toBe('100.00');
    expect(referrer?.walletRole).toBe('tasker');
    expect(referrer?.idempotencyKey).toContain('referrer-uid');
  });

  it('poster program: referee welcome on enroll only (referrer on qualify)', async () => {
    const snapshot = getDefaultPosterRewardProgramV1();
    const enrollGrants = await GrantResolver.resolve(snapshot, 'on_enroll', {
      enrollmentId: 'enr-poster',
      referrerUid: 'referrer-uid',
      refereeUid: 'referee-uid',
      referralCode: 'POST1234',
      referralChannel: 'poster',
    });

    expect(enrollGrants).toHaveLength(1);
    expect(enrollGrants[0].walletRole).toBe('poster');
    expect(enrollGrants[0].metadata.source).toBe('referral_welcome');

    const qualifyGrants = await GrantResolver.resolve(snapshot, 'on_qualify', {
      enrollmentId: 'enr-poster',
      referrerUid: 'referrer-uid',
      refereeUid: 'referee-uid',
      referralCode: 'POST1234',
      referralChannel: 'poster',
    });

    expect(qualifyGrants).toHaveLength(1);
    expect(qualifyGrants[0].walletRole).toBe('poster');
    expect(qualifyGrants[0].metadata.source).toBe('referral_signup');
  });

  it('uses explicit refereeWalletRole and referrerWalletRole when provided', async () => {
    const snapshot = getDefaultRewardProgramV1();
    const grants = await GrantResolver.resolve(snapshot, 'on_enroll', {
      enrollmentId: 'enr-split',
      referrerUid: 'referrer-uid',
      refereeUid: 'referee-uid',
      referralCode: 'SPLIT123',
      referralChannel: 'poster',
      refereeWalletRole: 'tasker',
      referrerWalletRole: 'poster',
    });

    const referrer = grants.find((g) => g.metadata.source === 'referral_signup');
    const referee = grants.find((g) => g.metadata.source === 'referral_welcome');
    expect(referrer?.walletRole).toBe('poster');
    expect(referee?.walletRole).toBe('tasker');
  });
});
