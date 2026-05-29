import Profile from '../../../models/Profile';
import { ReferralRecord } from '../../../models/ReferralRecord';
import { BadRequestError } from '../../../errors/AppError';
import { hashReferralPhone } from '../../antiAbuse/utils/phoneHash.util';
import type { ReferralChannel } from '../../utils/walletRole';
import mongoose from 'mongoose';

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

    return { refereePhoneHash, referrerIsAadhaarVerified };
  }
}
