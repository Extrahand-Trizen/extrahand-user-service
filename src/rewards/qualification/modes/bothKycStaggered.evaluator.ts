import Profile from '../../../models/Profile';
import { ReferralStatus } from '../../../types/referral';
import type { RewardProgramSnapshot } from '../../types/RewardProgram';
import { GrantResolver, type ResolveGrantsContext } from '../../grants/GrantResolver';
import { ReferralEligibilityService } from '../../referral/services/ReferralEligibilityService';
import type { QualificationEvaluation } from '../QualificationEngine';

type EnrollmentSlice = {
  status: string;
  expiresAt: Date;
  referrerUid?: string;
  refereeUid?: string;
};

type IdentityPayload = {
  refereeUid?: string;
  referrerUid?: string;
  uid?: string;
};

/**
 * BOTH_KYC staggered: referrer paid on enroll (if KYC), referee paid on qualify (Aadhaar).
 */
export class BothKycStaggeredEvaluator {
  static async evaluateOnEnroll(
    enrollment: EnrollmentSlice,
    snapshot: RewardProgramSnapshot,
    ctx: ResolveGrantsContext
  ): Promise<QualificationEvaluation> {
    if (enrollment.status !== ReferralStatus.PENDING) {
      return { shouldQualify: false, grants: [], reason: 'not_pending' };
    }

    const enrollGrants = await GrantResolver.resolve(snapshot, 'on_enroll', ctx);
    if (!enrollGrants.length) {
      return { shouldQualify: false, grants: [], reason: 'no_enroll_grants' };
    }

    const referrerProfile = enrollment.referrerUid
      ? await Profile.findOne({ uid: enrollment.referrerUid }).select('isAadhaarVerified').lean()
      : null;

    if (!ReferralEligibilityService.isAadhaarVerified(referrerProfile)) {
      return {
        shouldQualify: false,
        grants: [],
        reason: 'referrer_kyc_required_for_enroll_grant',
      };
    }

    return { shouldQualify: false, grants: enrollGrants, reason: 'staggered_enroll_referrer_only' };
  }

  static async evaluateOnIdentityVerified(
    enrollment: EnrollmentSlice,
    snapshot: RewardProgramSnapshot,
    ctx: ResolveGrantsContext,
    payload: IdentityPayload
  ): Promise<QualificationEvaluation> {
    if (enrollment.status !== ReferralStatus.PENDING) {
      return { shouldQualify: false, grants: [] };
    }
    if (new Date() > enrollment.expiresAt) {
      return { shouldQualify: false, grants: [], reason: 'expired' };
    }

    const eventUid = String(payload.uid || payload.refereeUid || payload.referrerUid || '').trim();
    if (
      eventUid &&
      eventUid !== String(enrollment.refereeUid || '').trim() &&
      eventUid !== String(enrollment.referrerUid || '').trim()
    ) {
      return { shouldQualify: false, grants: [], reason: 'uid_not_participant' };
    }

    const [referrerProfile, refereeProfile] = await Promise.all([
      enrollment.referrerUid
        ? Profile.findOne({ uid: enrollment.referrerUid }).select('isAadhaarVerified').lean()
        : null,
      enrollment.refereeUid
        ? Profile.findOne({ uid: enrollment.refereeUid }).select('isAadhaarVerified').lean()
        : null,
    ]);

    const referrerKyc = ReferralEligibilityService.isAadhaarVerified(referrerProfile);
    const refereeKyc = ReferralEligibilityService.isAadhaarVerified(refereeProfile);

    if (!referrerKyc || !refereeKyc) {
      return { shouldQualify: false, grants: [], reason: 'both_kyc_required' };
    }

    const allQualifyGrants = await GrantResolver.resolve(snapshot, 'on_qualify', ctx);
    const refereeGrants = allQualifyGrants.filter(
      (g) => g.recipientUid === ctx.refereeUid
    );

    return {
      shouldQualify: refereeGrants.length > 0,
      grants: refereeGrants,
      reason: refereeGrants.length ? 'staggered_referee_qualify' : 'no_referee_qualify_grants',
    };
  }
}
