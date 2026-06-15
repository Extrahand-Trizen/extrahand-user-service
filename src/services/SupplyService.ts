import mongoose from 'mongoose';
import Profile from '../models/Profile';
import PartnerCapability from '../models/PartnerCapability';
import PartnerApplication from '../models/PartnerApplication';
import PartnerServiceArea from '../models/PartnerServiceArea';
import PartnerAvailability from '../models/PartnerAvailability';
import PartnerDocument from '../models/PartnerDocument';
import { BadRequestError, NotFoundError } from '../errors/AppError';
import type { CapabilityType, PartnerDocumentType } from '../types/supply';

function defaultPartnerProfile() {
  return {
    status: 'not_applied' as const,
    onboardingCompleted: false,
    languages: [] as string[],
  };
}

function ensurePartnerProfile(profile: InstanceType<typeof Profile>) {
  if (!profile.partnerProfile) {
    profile.partnerProfile = defaultPartnerProfile();
  }
  return profile.partnerProfile;
}

export class SupplyService {
  static async getProfileByUid(uid: string) {
    const profile = await Profile.findOne({ uid });
    if (!profile) throw new NotFoundError('Profile not found');
    return profile;
  }

  static async getSupplySummary(uid: string) {
    const profile = await this.getProfileByUid(uid);
    const profileId = profile._id;

    const [capabilities, applications, serviceAreas, availability, documents] = await Promise.all([
      PartnerCapability.find({ profileId }).lean(),
      PartnerApplication.find({ profileId }).sort({ createdAt: -1 }).limit(10).lean(),
      PartnerServiceArea.find({ profileId, isActive: true }).lean(),
      PartnerAvailability.findOne({ profileId }).lean(),
      PartnerDocument.find({ profileId }).lean(),
    ]);

    const completionPercent = this.calculateCompletionPercent(profile, {
      capabilities,
      serviceAreas,
      documents,
    });

    return {
      partnerProfile: profile.partnerProfile ?? defaultPartnerProfile(),
      supplyPrograms: profile.supplyPrograms ?? [],
      capabilities,
      applications,
      serviceAreas,
      availability: availability ?? {
        isOnline: false,
        currentStatus: 'offline',
        autoAccept: false,
      },
      documents,
      completionPercent,
      profileId: profileId.toString(),
      uid: profile.uid,
      kyc: {
        isAadhaarVerified: profile.isAadhaarVerified,
        isPANVerified: profile.isPANVerified,
        isBankVerified: profile.isBankVerified,
        photoURL: profile.photoURL,
      },
    };
  }

  static calculateCompletionPercent(
    profile: InstanceType<typeof Profile>,
    extras: {
      capabilities: unknown[];
      serviceAreas: unknown[];
      documents: unknown[];
    },
  ): number {
    const checks = [
      profile.isAadhaarVerified,
      profile.isPANVerified,
      profile.isBankVerified,
      Boolean(profile.photoURL),
      extras.capabilities.length > 0,
      extras.serviceAreas.length > 0,
      profile.partnerProfile?.gender,
      (profile.partnerProfile?.languages?.length ?? 0) > 0,
    ];
    const done = checks.filter(Boolean).length;
    return Math.round((done / checks.length) * 100);
  }

  static async patchPartnerProfile(
    uid: string,
    patch: { gender?: string; dob?: Date | string; languages?: string[] },
  ) {
    const profile = await this.getProfileByUid(uid);
    const partnerProfile = ensurePartnerProfile(profile);
    if (patch.gender !== undefined) partnerProfile.gender = patch.gender;
    if (patch.dob !== undefined) partnerProfile.dob = new Date(patch.dob);
    if (patch.languages !== undefined) partnerProfile.languages = patch.languages;
    if (partnerProfile.status === 'not_applied') {
      partnerProfile.status = 'draft';
    }
    profile.markModified('partnerProfile');
    await profile.save();
    return this.getSupplySummary(uid);
  }

  static async createCapability(
    uid: string,
    data: { capabilityType: CapabilityType; categorySlug: string; metadata?: Record<string, unknown> },
  ) {
    const profile = await this.getProfileByUid(uid);
    const partnerProfile = ensurePartnerProfile(profile);
    if (partnerProfile.status === 'not_applied') {
      partnerProfile.status = 'draft';
      profile.markModified('partnerProfile');
      await profile.save();
    }

    const existing = await PartnerCapability.findOne({
      profileId: profile._id,
      capabilityType: data.capabilityType,
      categorySlug: data.categorySlug,
    });
    if (existing) {
      throw new BadRequestError('Capability already exists for this category');
    }

    const capability = await PartnerCapability.create({
      profileId: profile._id,
      uid,
      capabilityType: data.capabilityType,
      categorySlug: data.categorySlug,
      status: 'pending',
      metadata: data.metadata ?? {},
    });

    return capability;
  }

  static async updateCapability(
    uid: string,
    capabilityId: string,
    patch: { metadata?: Record<string, unknown> },
  ) {
    const profile = await this.getProfileByUid(uid);
    const capability = await PartnerCapability.findOne({
      _id: capabilityId,
      profileId: profile._id,
    });
    if (!capability) throw new NotFoundError('Capability not found');
    if (patch.metadata) {
      capability.metadata = { ...capability.metadata, ...patch.metadata };
    }
    await capability.save();
    return capability;
  }

  static async submitApplication(uid: string) {
    const profile = await this.getProfileByUid(uid);
    const partnerProfile = ensurePartnerProfile(profile);

    const capabilities = await PartnerCapability.find({ profileId: profile._id });
    if (capabilities.length === 0) {
      throw new BadRequestError('Add at least one capability before applying');
    }

    partnerProfile.status = 'pending_review';
    partnerProfile.onboardingCompleted = true;
    profile.markModified('partnerProfile');
    await profile.save();

    const application = await PartnerApplication.create({
      profileId: profile._id,
      uid,
      status: 'pending_review',
      capabilityIds: capabilities.map((c) => c._id),
      submittedAt: new Date(),
    });

    return { application, summary: await this.getSupplySummary(uid) };
  }

  static async listApplications(uid: string) {
    const profile = await this.getProfileByUid(uid);
    return PartnerApplication.find({ profileId: profile._id }).sort({ createdAt: -1 }).lean();
  }

  static async upsertServiceArea(
    uid: string,
    data: {
      capabilityId?: string;
      city: string;
      localities?: string[];
      pinCodes?: string[];
      radiusKm?: number;
    },
  ) {
    const profile = await this.getProfileByUid(uid);
    const area = await PartnerServiceArea.findOneAndUpdate(
      { profileId: profile._id, city: data.city },
      {
        profileId: profile._id,
        uid,
        capabilityId: data.capabilityId
          ? new mongoose.Types.ObjectId(data.capabilityId)
          : undefined,
        city: data.city,
        localities: data.localities ?? [],
        pinCodes: data.pinCodes ?? [],
        radiusKm: data.radiusKm,
        isActive: true,
      },
      { upsert: true, new: true },
    );
    return area;
  }

  static async listServiceAreas(uid: string) {
    const profile = await this.getProfileByUid(uid);
    return PartnerServiceArea.find({ profileId: profile._id }).lean();
  }

  static async updateAvailability(
    uid: string,
    patch: { isOnline?: boolean; currentStatus?: 'available' | 'busy' | 'offline' },
  ) {
    const profile = await this.getProfileByUid(uid);
    const partnerProfile = profile.partnerProfile;
    if (!partnerProfile || partnerProfile.status !== 'approved') {
      throw new BadRequestError('Partner must be approved before changing availability');
    }

    const now = new Date();
    const availability = await PartnerAvailability.findOneAndUpdate(
      { profileId: profile._id },
      {
        profileId: profile._id,
        uid,
        isOnline: patch.isOnline ?? false,
        currentStatus: patch.currentStatus ?? (patch.isOnline ? 'available' : 'offline'),
        lastSeenAt: now,
        lastToggledAt: now,
      },
      { upsert: true, new: true },
    );
    return availability;
  }

  static async createDocument(
    uid: string,
    data: {
      capabilityId?: string;
      documentType: PartnerDocumentType;
      fileUrl: string;
      metadata?: Record<string, unknown>;
    },
  ) {
    const profile = await this.getProfileByUid(uid);
    const doc = await PartnerDocument.create({
      profileId: profile._id,
      uid,
      capabilityId: data.capabilityId
        ? new mongoose.Types.ObjectId(data.capabilityId)
        : undefined,
      documentType: data.documentType,
      fileUrl: data.fileUrl,
      verificationStatus: 'pending',
      metadata: data.metadata,
    });

    if (data.capabilityId) {
      await PartnerCapability.updateOne(
        { _id: data.capabilityId, profileId: profile._id },
        { $addToSet: { documents: doc._id } },
      );
    }

    return doc;
  }

  static async listDocuments(uid: string) {
    const profile = await this.getProfileByUid(uid);
    return PartnerDocument.find({ profileId: profile._id }).lean();
  }

  /** Internal: dispatch candidate query */
  static async findEligiblePartners(params: {
    categorySlug?: string;
    capabilityType?: CapabilityType;
    pinCode?: string;
    city?: string;
    limit?: number;
    requireOnline?: boolean;
  }) {
    const limit = Math.min(params.limit ?? 10, 50);
    const capQuery: Record<string, unknown> = { status: 'approved' };
    if (params.categorySlug) capQuery.categorySlug = params.categorySlug;
    if (params.capabilityType) capQuery.capabilityType = params.capabilityType;

    const approvedCaps = await PartnerCapability.find(capQuery).limit(limit * 3).lean();
    if (approvedCaps.length === 0) return [];

    const profileIds = [...new Set(approvedCaps.map((c) => c.profileId.toString()))];
    const profiles = await Profile.find({
      _id: { $in: profileIds },
      'partnerProfile.status': 'approved',
    }).lean();

    const approvedProfileIds = new Set(profiles.map((p) => p._id.toString()));
    let candidateUids = approvedCaps
      .filter((c) => approvedProfileIds.has(c.profileId.toString()))
      .map((c) => c.uid);

    candidateUids = [...new Set(candidateUids)];

    if (params.requireOnline) {
      const online = await PartnerAvailability.find({
        uid: { $in: candidateUids },
        isOnline: true,
        currentStatus: 'available',
      }).lean();
      const onlineUids = new Set(online.map((a) => a.uid));
      candidateUids = candidateUids.filter((u) => onlineUids.has(u));
    }

    if (params.pinCode || params.city) {
      const areaQuery: Record<string, unknown> = {
        isActive: true,
        uid: { $in: candidateUids },
      };
      if (params.pinCode) areaQuery.pinCodes = params.pinCode;
      if (params.city) areaQuery.city = new RegExp(`^${params.city}$`, 'i');

      const areas = await PartnerServiceArea.find(areaQuery).lean();
      const areaUids = new Set(areas.map((a) => a.uid));

      if (params.pinCode && areaUids.size === 0 && params.city) {
        const cityAreas = await PartnerServiceArea.find({
          isActive: true,
          uid: { $in: candidateUids },
          city: new RegExp(`^${params.city}$`, 'i'),
        }).lean();
        cityAreas.forEach((a) => areaUids.add(a.uid));
      }

      if (params.pinCode || params.city) {
        candidateUids = candidateUids.filter((u) => areaUids.has(u));
      }
    }

    const resultProfiles = profiles
      .filter((p) => candidateUids.includes(p.uid))
      .slice(0, limit);

    return resultProfiles.map((p) => {
      const caps = approvedCaps.filter((c) => c.profileId.toString() === p._id.toString());
      return {
        uid: p.uid,
        profileId: p._id.toString(),
        name: p.name,
        photoURL: p.photoURL,
        rating: p.rating,
        capabilities: caps.map((c) => ({
          id: c._id.toString(),
          capabilityType: c.capabilityType,
          categorySlug: c.categorySlug,
        })),
      };
    });
  }

  /** Admin: list pending applications */
  static async listPendingApplications(limit = 50, page = 1) {
    const skip = (Math.max(page, 1) - 1) * limit;
    const [applications, total] = await Promise.all([
      PartnerApplication.find({ status: 'pending_review' })
        .sort({ submittedAt: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      PartnerApplication.countDocuments({ status: 'pending_review' }),
    ]);
    return { applications, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
  }

  static async reviewApplication(
    applicationId: string,
    decision: 'approve' | 'reject',
    reviewedBy: string,
    reviewNotes?: string,
  ) {
    const application = await PartnerApplication.findById(applicationId);
    if (!application) throw new NotFoundError('Application not found');
    if (application.status !== 'pending_review') {
      throw new BadRequestError(`Application is already ${application.status}`);
    }

    const profile = await Profile.findById(application.profileId);
    if (!profile) throw new NotFoundError('Profile not found');

    const now = new Date();
    application.reviewedAt = now;
    application.reviewedBy = reviewedBy;
    application.reviewNotes = reviewNotes;

    if (decision === 'approve') {
      application.status = 'approved';
      const partnerProfile = ensurePartnerProfile(profile);
      partnerProfile.status = 'approved';
      partnerProfile.approvedAt = now;
      partnerProfile.approvedBy = reviewedBy;
      profile.markModified('partnerProfile');
      if (!profile.supplyPrograms?.includes('book_now')) {
        profile.supplyPrograms = [...(profile.supplyPrograms ?? []), 'book_now'];
      }
      await PartnerCapability.updateMany(
        { _id: { $in: application.capabilityIds } },
        { status: 'approved', approvedAt: now, approvedBy: reviewedBy },
      );
    } else {
      application.status = 'rejected';
      const partnerProfile = ensurePartnerProfile(profile);
      partnerProfile.status = 'rejected';
      profile.markModified('partnerProfile');
    }

    await Promise.all([application.save(), profile.save()]);
    return { application, profile };
  }

  static async suspendPartner(profileId: string, suspendedBy: string, reason?: string) {
    const profile = await Profile.findById(profileId);
    if (!profile) throw new NotFoundError('Profile not found');
    const partnerProfile = ensurePartnerProfile(profile);
    partnerProfile.status = 'suspended';
    profile.markModified('partnerProfile');
    await profile.save();
    await PartnerAvailability.updateOne(
      { profileId: profile._id },
      { isOnline: false, currentStatus: 'offline', lastToggledAt: new Date() },
    );
    return { profile, reason, suspendedBy };
  }
}
