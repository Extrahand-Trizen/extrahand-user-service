import Profile from '../../../models/Profile';
import { ReferralRecord } from '../../../models/ReferralRecord';
import { BadRequestError } from '../../../errors/AppError';
import { hashReferralPhone } from '../../antiAbuse/utils/phoneHash.util';
import { ReferralConsumptionService } from '../../antiAbuse/services/ReferralConsumptionService';
import { findRefereeEnrollmentForProfile } from '../referralEnrollmentLookup';
import type { ReferralChannel } from '../../utils/walletRole';
import mongoose from 'mongoose';

export type RefereeWelcomeIneligibleReason =
  | 'already_consumed'
  | 'welcome_already_received'
  | 'no_phone'
  | 'no_enrollment'
  | 'not_tasker_referral';

export interface RefereeWelcomeEligibilityResult {
  eligible: boolean;
  reason?: RefereeWelcomeIneligibleReason;
  referralCode?: string;
  refereeCoins?: number;
  /** True when signup welcome was already credited on this enrollment (not a new-user block). */
  welcomeFulfilled?: boolean;
}

function isEnrollmentRefereeWelcomeFulfilled(enrollment: {
  grantsStatus?: string | null;
  refereeRewardCredited?: Date | null;
} | null): boolean {
  if (!enrollment) return false;
  if (enrollment.refereeRewardCredited) return true;
  const status = String(enrollment.grantsStatus || '').toLowerCase();
  return status === 'completed' || status === 'partial';
}

export interface ReferralApplyEligibilityInput {
  refereeUid: string;
  refereeProfileId: string;
  referrerProfileId: string;
  referralChannel: ReferralChannel;
}

export interface ReferralApplyEligibilityResult {
  refereePhoneHash: string;
  referrerIsAadhaarVerified: boolean;
}

export class ReferralEligibilityService {
  static isAadhaarVerified(profile: { isAadhaarVerified?: unknown } | null): boolean {
    const v = profile?.isAadhaarVerified;
    return v === true || v === 'true';
  }

  static async validateApply(
    input: ReferralApplyEligibilityInput
  ): Promise<ReferralApplyEligibilityResult> {
    const [refereeProfile, referrerProfile] = await Promise.all([
      Profile.findOne({ uid: input.refereeUid }).select('phone isAadhaarVerified').lean(),
      Profile.findById(input.referrerProfileId).select('isAadhaarVerified uid').lean(),
    ]);

    if (!refereeProfile) {
      throw new BadRequestError('Referee profile not found');
    }

    const refereePhoneHash = hashReferralPhone(
      (refereeProfile as { phone?: string }).phone
    );
    if (!refereePhoneHash) {
      throw new BadRequestError(
        'A verified phone number is required before applying a referral code'
      );
    }

    const referrerIsAadhaarVerified = this.isAadhaarVerified(referrerProfile);

    if (input.referralChannel === 'tasker' && !referrerIsAadhaarVerified) {
      throw new BadRequestError(
        'Referrer must complete Aadhaar verification before sharing helper referral rewards'
      );
    }

    const referrerObjectId = new mongoose.Types.ObjectId(input.referrerProfileId);
    const existingPair = await ReferralRecord.findOne({
      referrerId: referrerObjectId,
      refereePhoneHash,
    })
      .select('_id grantsStatus status')
      .lean();

    if (existingPair) {
      throw new BadRequestError(
        'This phone number has already been referred by this referrer'
      );
    }

    const consumption = await ReferralConsumptionService.checkRefereeWelcome(
      refereePhoneHash,
      input.referralChannel
    );
    if (!consumption.allowed) {
      throw new BadRequestError(
        input.referralChannel === 'poster'
          ? 'This phone number has already received a customer signup referral bonus'
          : 'This phone number has already received a helper signup referral bonus'
      );
    }

    return { refereePhoneHash, referrerIsAadhaarVerified };
  }

  /** Whether this signed-in user can still receive helper referee welcome coins (phone not consumed). */
  static async checkRefereeWelcomeEligibility(
    uid: string
  ): Promise<RefereeWelcomeEligibilityResult> {
    const profile = await Profile.findOne({ uid }).select('_id phone').lean();
    if (!profile) {
      return { eligible: false, reason: 'no_enrollment' };
    }

    const profilePhoneHash = hashReferralPhone((profile as { phone?: string }).phone);

    const enrollmentDoc = await findRefereeEnrollmentForProfile(profile._id, uid);
    const enrollment = enrollmentDoc
      ? {
          referralChannel: enrollmentDoc.referralChannel,
          referralCode: enrollmentDoc.referralCode,
          refereePhoneHash: enrollmentDoc.refereePhoneHash,
          grantsStatus: enrollmentDoc.grantsStatus,
          refereeRewardCredited: enrollmentDoc.refereeRewardCredited,
        }
      : null;

    const channel = enrollment
      ? String(enrollment.referralChannel || '').toLowerCase()
      : 'tasker';

    if (enrollment && channel !== 'tasker') {
      return { eligible: false, reason: 'not_tasker_referral' };
    }

    const phoneHash =
      enrollment?.refereePhoneHash || profilePhoneHash;
    if (!phoneHash) {
      return { eligible: false, reason: 'no_phone' };
    }

    // Lifetime phone consumption — checked even without enrollment (delete/recreate, failed apply).
    const consumption = await ReferralConsumptionService.checkRefereeWelcome(
      phoneHash,
      'tasker'
    );
    if (!consumption.allowed) {
      if (enrollment && isEnrollmentRefereeWelcomeFulfilled(enrollment)) {
        return {
          eligible: false,
          reason: 'welcome_already_received',
          welcomeFulfilled: true,
          referralCode: enrollment.referralCode,
        };
      }
      return {
        eligible: false,
        reason: 'already_consumed',
        referralCode: enrollment?.referralCode,
      };
    }

    if (!enrollment) {
      return { eligible: false, reason: 'no_enrollment' };
    }

    return {
      eligible: true,
      referralCode: enrollment.referralCode,
    };
  }
}
