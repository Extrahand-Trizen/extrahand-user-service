import type { GrantSpec } from '../../types/GrantSpec';
import {
  ReferralConsumptionService,
  grantTargetsReferrerEnrollPayout,
  grantTargetsReferrerReferralPayout,
  grantTargetsRefereeWelcome,
} from './ReferralConsumptionService';

describe('ReferralConsumptionService grant helpers', () => {
  const refereeGrant: GrantSpec = {
    idempotencyKey: 'referee-key',
    recipientUid: 'referee-uid',
    coins: '100.00',
    rupeeValue: '100.00',
    expiresAt: new Date().toISOString(),
    metadata: {
      source: 'referral_welcome',
      enrollmentId: 'enr1',
      referralCode: 'CODE',
      referrerUid: 'referrer-uid',
      refereeUid: 'referee-uid',
    },
  };

  const referrerGrant: GrantSpec = {
    idempotencyKey: 'referrer-key',
    recipientUid: 'referrer-uid',
    coins: '100.00',
    rupeeValue: '100.00',
    expiresAt: new Date().toISOString(),
    metadata: {
      source: 'referral_task_bonus',
      enrollmentId: 'enr1',
      referralCode: 'CODE',
      referrerUid: 'referrer-uid',
      refereeUid: 'referee-uid',
    },
  };

  it('identifies referee welcome grants', () => {
    expect(grantTargetsRefereeWelcome(refereeGrant)).toBe(true);
    expect(grantTargetsRefereeWelcome(referrerGrant)).toBe(false);
  });

  it('identifies referrer referral payouts', () => {
    expect(grantTargetsReferrerReferralPayout(referrerGrant)).toBe(true);
    expect(grantTargetsReferrerReferralPayout(refereeGrant)).toBe(false);
  });
});

describe('ReferralConsumptionService.filterGrantsByConsumption', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('blocks referee welcome and referrer enroll when phone already consumed', async () => {
    jest.spyOn(ReferralConsumptionService, 'checkRefereeWelcome').mockResolvedValue({
      allowed: false,
      blocked: [{ rewardType: 'referee_poster_welcome', reason: 'already_consumed' }],
    });

    const refereeGrant: GrantSpec = {
      idempotencyKey: 'referee-key',
      recipientUid: 'referee-uid',
      coins: '100.00',
      rupeeValue: '100.00',
      expiresAt: new Date().toISOString(),
      metadata: {
        source: 'referral_welcome',
        enrollmentId: 'enr1',
        referralCode: 'CODE',
        referrerUid: 'referrer-uid',
        refereeUid: 'referee-uid',
      },
    };

    const referrerEnrollGrant: GrantSpec = {
      idempotencyKey: 'referrer-enroll-key',
      recipientUid: 'referrer-uid',
      coins: '100.00',
      rupeeValue: '100.00',
      expiresAt: new Date().toISOString(),
      metadata: {
        source: 'referral_signup',
        enrollmentId: 'enr1',
        referralCode: 'CODE',
        referrerUid: 'referrer-uid',
        refereeUid: 'referee-uid',
      },
    };

    const filtered = await ReferralConsumptionService.filterGrantsByConsumption({
      grants: [refereeGrant, referrerEnrollGrant],
      refereePhoneHash: 'phone-hash',
      referralChannel: 'poster',
    });

    expect(filtered).toEqual([]);
    expect(grantTargetsReferrerEnrollPayout(referrerEnrollGrant)).toBe(true);
  });

  it('allows referrer qualify grant when phone consumed on same enrollment signup', async () => {
    jest.spyOn(ReferralConsumptionService, 'checkRefereeWelcome').mockResolvedValue({
      allowed: false,
      blocked: [{ rewardType: 'referee_poster_welcome', reason: 'already_consumed' }],
    });

    const referrerQualifyGrant: GrantSpec = {
      idempotencyKey: 'referrer-key',
      recipientUid: 'referrer-uid',
      coins: '100.00',
      rupeeValue: '100.00',
      expiresAt: new Date().toISOString(),
      metadata: {
        source: 'referral_task_bonus',
        enrollmentId: 'enr1',
        referralCode: 'CODE',
        referrerUid: 'referrer-uid',
        refereeUid: 'referee-uid',
      },
    };

    const filtered = await ReferralConsumptionService.filterGrantsByConsumption({
      grants: [referrerQualifyGrant],
      refereePhoneHash: 'phone-hash',
      referralChannel: 'poster',
    });

    expect(filtered).toEqual([referrerQualifyGrant]);
  });
});
