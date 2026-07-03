import Profile from "../models/Profile";
import logger from "../config/logger";

export function normalizePhoneToLast10(phone?: string | null): string {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length < 10) return "";
  return digits.slice(-10);
}

export function buildPhoneSearchVariants(phone?: string | null): string[] {
  const digits = String(phone || "").replace(/\D/g, "");
  const last10 = normalizePhoneToLast10(phone);
  if (!last10) return [];

  const variants = [
    `+91${last10}`,
    `+91-${last10}`,
    `+91 ${last10}`,
    `91${last10}`,
    `91 ${last10}`,
    last10,
    digits,
    digits.startsWith("91") ? `+${digits}` : `+91${digits}`,
  ];

  return [...new Set(variants.filter(Boolean))];
}

/** Any profile row holding this phone (including deleted / inactive). Dummy-auth collision helper only. */
async function findProfileByPhoneForDummyCollision(phone?: string | null) {
  const phoneVariants = buildPhoneSearchVariants(phone);
  const last10 = normalizePhoneToLast10(phone);
  if (!phoneVariants.length) return null;

  return Profile.findOne({
    $or: [
      { phone: { $in: phoneVariants } },
      ...(last10 ? [{ phone: { $regex: new RegExp(`${last10}$`) } }] : []),
    ],
  }).lean();
}

export async function findActiveProfileByUidOrPhone(params: {
  uid?: string;
  phone?: string | null;
}) {
  const { uid, phone } = params;
  const phoneVariants = buildPhoneSearchVariants(phone);

  const clauses: any[] = [];
  if (uid) clauses.push({ uid });
  if (phoneVariants.length > 0) {
    clauses.push({ phone: { $in: phoneVariants } });
    clauses.push({ phone: { $regex: new RegExp(`${normalizePhoneToLast10(phone)}$`) } });
  }

  if (clauses.length === 0) return null;

  return Profile.findOne({
    "dataPrivacy.accountDeleted": { $ne: true },
    isActive: { $ne: false },
    $or: clauses,
  });
}

export async function reconcileProfileUidByPhone(params: {
  firebaseUid: string;
  phone?: string | null;
  preferredName?: string;
  applyChanges: boolean;
}) {
  const { firebaseUid, phone, preferredName, applyChanges } = params;
  const profileForUid = await Profile.findOne({ uid: firebaseUid });
  const profileForPhone = await findActiveProfileByUidOrPhone({ phone });

  if (profileForUid && profileForPhone && String(profileForUid._id) !== String(profileForPhone._id)) {
    logger.warn("Identity mismatch: uid and phone resolve to different profiles", {
      firebaseUid,
      phone,
      uidProfileId: String(profileForUid._id),
      phoneProfileId: String(profileForPhone._id),
    });
    return { resolved: false, reason: "conflicting_profiles", profile: profileForUid };
  }

  if (profileForUid) {
    const updates: Record<string, unknown> = {};
    if (phone && profileForUid.phone !== phone) updates.phone = phone;
    if (preferredName && profileForUid.name !== preferredName) updates.name = preferredName;

    if (applyChanges && Object.keys(updates).length > 0) {
      updates.updatedAt = Date.now();
      await Profile.updateOne({ _id: profileForUid._id }, { $set: updates });
      Object.assign(profileForUid, updates);
    }

    return { resolved: true, reason: "uid_profile", profile: profileForUid };
  }

  if (profileForPhone) {
    if (applyChanges) {
      await Profile.updateOne(
        { _id: profileForPhone._id },
        {
          $set: {
            uid: firebaseUid,
            ...(preferredName ? { name: preferredName } : {}),
            ...(phone ? { phone } : {}),
            updatedAt: Date.now(),
          },
        }
      );
      profileForPhone.uid = firebaseUid;
      if (preferredName) profileForPhone.name = preferredName;
      if (phone) profileForPhone.phone = phone;
    }

    logger.info("Reconciled profile UID using phone match", {
      firebaseUid,
      phone,
      profileId: String(profileForPhone._id),
      applyChanges,
    });
    return { resolved: true, reason: "phone_profile_rebound", profile: profileForPhone };
  }

  return { resolved: false, reason: "not_found", profile: null };
}

/**
 * Revive a deleted/inactive profile after OTP login.
 *
 * When `resolveDummyPhoneCollision` is true (local dummy OTP only): may unset `phone` on another
 * row so `phone_1` unique index does not throw. Never pass true for production Firebase OTP.
 */
export async function reactivateDeletedProfile(params: {
  firebaseUid: string;
  phone: string;
  preferredName: string;
  resolveDummyPhoneCollision?: boolean;
}): Promise<Record<string, unknown> | null> {
  const { firebaseUid, phone, preferredName, resolveDummyPhoneCollision = false } = params;
  const uidProfile = await Profile.findOne({ uid: firebaseUid }).lean();
  const needsReactivation =
    uidProfile &&
    ((uidProfile as any).dataPrivacy?.accountDeleted || uidProfile.isActive === false);

  if (!needsReactivation) return null;

  const now = Date.now();
  const reactivationSet: Record<string, unknown> = {
    name: preferredName,
    phone,
    isActive: true,
    status: "active",
    updatedAt: now,
    "dataPrivacy.deletionRequested": false,
    "dataPrivacy.deletionRequestedAt": null,
    "dataPrivacy.deletionScheduledFor": null,
    "dataPrivacy.accountDeleted": false,
    "dataPrivacy.accountDeletedAt": null,
    "dataPrivacy.accountDeletionReason": null,
  };

  if (!resolveDummyPhoneCollision) {
    const reactivated = await Profile.findOneAndUpdate(
      { uid: firebaseUid },
      { $set: reactivationSet },
      { new: true },
    ).lean();
    if (reactivated) {
      logger.info("Reactivated deleted profile", { firebaseUid });
    }
    return reactivated as Record<string, unknown> | null;
  }

  const phoneHolder = await findProfileByPhoneForDummyCollision(phone);
  if (phoneHolder && phoneHolder.uid !== firebaseUid) {
    await Profile.updateOne(
      { _id: phoneHolder._id },
      { $unset: { phone: "" }, $set: { updatedAt: now } },
    );
    logger.info("Cleared phone from conflicting profile before dummy reactivation", {
      firebaseUid,
      conflictingUid: phoneHolder.uid,
      conflictingProfileId: String(phoneHolder._id),
    });
  }

  try {
    const reactivated = await Profile.findOneAndUpdate(
      { uid: firebaseUid },
      { $set: reactivationSet },
      { new: true },
    ).lean();
    if (reactivated) {
      logger.info("Reactivated deleted profile (dummy collision path)", { firebaseUid });
    }
    return reactivated as Record<string, unknown> | null;
  } catch (error: any) {
    if (error?.code !== 11000) throw error;
    const holder = await findProfileByPhoneForDummyCollision(phone);
    if (holder && holder.uid !== firebaseUid) {
      await Profile.updateOne(
        { _id: holder._id },
        { $unset: { phone: "" }, $set: { updatedAt: now } },
      );
    }
    return Profile.findOneAndUpdate(
      { uid: firebaseUid },
      { $set: reactivationSet },
      { new: true },
    ).lean() as Promise<Record<string, unknown> | null>;
  }
}
