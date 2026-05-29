import { hashReferralPhone, requireReferralPhoneHash } from './phoneHash.util';

describe('phoneHash.util', () => {
  it('normalizes Indian numbers to stable hash', () => {
    const a = hashReferralPhone('+91 98765 43210');
    const b = hashReferralPhone('919876543210');
    expect(a).toBeTruthy();
    expect(a).toBe(b);
  });

  it('requireReferralPhoneHash throws when phone missing', () => {
    expect(() => requireReferralPhoneHash('')).toThrow(/phone/i);
  });
});
