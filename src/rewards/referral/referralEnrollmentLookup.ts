import type { Types } from 'mongoose';
import ReferralRecord, { type IReferralRecord } from '../../models/ReferralRecord';
import logger from '../../config/logger';

/**
 * Find helper referee enrollment by current profile id, then Firebase uid.
 * Heals refereeId/refereeUid when profile was recreated (split identity).
 */
export async function findRefereeEnrollmentForProfile(
  profileId: Types.ObjectId,
  refereeUid: string
): Promise<IReferralRecord | null> {
  let enrollment = await ReferralRecord.findOne({ refereeId: profileId });
  if (enrollment) return enrollment;

  const uid = String(refereeUid || '').trim();
  if (!uid) return null;

  enrollment = await ReferralRecord.findOne({ refereeUid: uid });
  if (!enrollment) return null;

  const profileIdStr = profileId.toString();
  const needsIdHeal = enrollment.refereeId.toString() !== profileIdStr;
  const needsUidHeal = enrollment.refereeUid !== uid;

  if (needsIdHeal || needsUidHeal) {
    logger.info('[REFERRAL_COINS] referral_enrollment_profile_heal', {
      enrollmentId: enrollment._id,
      previousRefereeId: enrollment.refereeId,
      previousRefereeUid: enrollment.refereeUid,
      refereeId: profileIdStr,
      refereeUid: uid,
    });
    if (needsIdHeal) enrollment.refereeId = profileId;
    if (needsUidHeal) enrollment.refereeUid = uid;
    await enrollment.save();
  }

  return enrollment;
}
