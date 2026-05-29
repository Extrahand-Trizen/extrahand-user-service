import { GrantResolver } from './GrantResolver';
import {
  getDefaultPosterRewardProgramV1,
  getDefaultRewardProgramV1,
} from '../seed/defaultRewardProgramV1';

describe('GrantResolver', () => {
  it('resolves staggered BOTH_KYC tasker enroll grant (referrer only on enroll)', async () => {
    const snapshot = getDefaultRewardProgramV1();
    const enrollGrants = await GrantResolver.resolve(snapshot, 'on_enroll', {
      enrollmentId: 'enr1',
      referrerUid: 'referrer-uid',
      refereeUid: 'referee-uid',
      referralCode: 'TEST1234',
      referralChannel: 'tasker',
      refereePhoneHash: 'abc123phonehash',
    });

    expect(enrollGrants).toHaveLength(1);
    expect(enrollGrants[0].metadata.source).toBe('referral_signup');
    expect(enrollGrants[0].coins).toBe('100.00');
    expect(enrollGrants[0].walletRole).toBe('tasker');
    expect(enrollGrants[0].idempotencyKey).toContain('abc123phonehash');

    const qualifyGrants = await GrantResolver.resolve(snapshot, 'on_qualify', {
      enrollmentId: 'enr1',
      referrerUid: 'referrer-uid',
      refereeUid: 'referee-uid',
      referralCode: 'TEST1234',
      referralChannel: 'tasker',
      refereePhoneHash: 'abc123phonehash',
    });
    expect(qualifyGrants).toHaveLength(1);
    expect(qualifyGrants[0].metadata.source).toBe('referral_task_bonus');
    expect(qualifyGrants[0].recipientUid).toBe('referee-uid');
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
      referralChannel: 'tasker',
      refereeWalletRole: 'tasker',
      referrerWalletRole: 'poster',
    });

    expect(grants).toHaveLength(1);
    expect(grants[0].metadata.source).toBe('referral_signup');
    expect(grants[0].walletRole).toBe('poster');
  });
});
