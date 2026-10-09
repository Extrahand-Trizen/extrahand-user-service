import mongoose from 'mongoose';
import Profile from '../models/Profile';
import PartnerCategoryRequest, {
  IPartnerCategoryRequest,
  PartnerCategoryRequestStatus,
} from '../models/PartnerCategoryRequest';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../errors/AppError';

const allowedExtras: Record<string, string[]> = {
  electrician: ['ac_service', 'appliance_repair'],
  appliance_repair: ['electrician', 'ac_service'],
  ac_service: ['electrician', 'appliance_repair'],
  delivery_logistics: ['driving'],
  driving: ['delivery_logistics'],
};
const validRequestedCategories = new Set(Object.values(allowedExtras).flat());
const requestedCategorySkills: Record<string, Set<string>> = {
  electrician: new Set([
    'fan_installation',
    'switch_socket_repair',
    'wiring_rewiring',
    'light_installation',
    'mcb_fuse_repair',
  ]),
  appliance_repair: new Set([
    'washing_machine_repair',
    'refrigerator_repair',
    'microwave_repair',
    'tv_repair',
    'water_purifier_repair',
  ]),
  ac_service: new Set([
    'ac_installation',
    'ac_general_service',
    'gas_filling',
    'cooling_issue_repair',
    'ac_uninstallation',
  ]),
  delivery_logistics: new Set([
    'pickup_drop',
    'courier',
    'grocery',
    'parcel',
    'quick_commerce_delivery',
  ]),
  driving: new Set(['personal_driver', 'driver_on_demand', 'commercial_driver']),
};

function profileCity(profile: any): string | undefined {
  return (
    profile.location?.addressDetails?.city ||
    profile.location?.city ||
    profile.homeLocation?.addressDetails?.city ||
    profile.savedAddresses?.find((address: any) => address.isDefault)?.city ||
    profile.savedAddresses?.[0]?.city ||
    undefined
  );
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class PartnerCategoryRequestService {
  static async create(
    uid: string,
    categoryId: unknown,
    requestedSkills: unknown,
  ): Promise<IPartnerCategoryRequest> {
    if (typeof categoryId !== 'string' || !validRequestedCategories.has(categoryId)) {
      throw new BadRequestError('Invalid categoryId');
    }
    if (
      !Array.isArray(requestedSkills) ||
      requestedSkills.length === 0 ||
      requestedSkills.length > requestedCategorySkills[categoryId].size ||
      requestedSkills.some(
        (skillId) =>
          typeof skillId !== 'string' ||
          !requestedCategorySkills[categoryId].has(skillId),
      )
    ) {
      throw new BadRequestError('Select at least one valid skill for the requested category');
    }
    const selectedSkills = [
      ...new Set(requestedSkills.filter((skillId): skillId is string => typeof skillId === 'string')),
    ];

    const profile = await Profile.findOne({ uid });
    if (
      !profile ||
      !profile.roles?.includes('partner') ||
      !profile.partnerProfile ||
      profile.partnerProfile.status !== 'approved'
    ) {
      throw new ForbiddenError('An approved partner profile is required');
    }

    const categories = Array.isArray(profile.partnerProfile.categories)
      ? profile.partnerProfile.categories
      : [];
    const eligibleCategories = new Set(categories.flatMap((category) => allowedExtras[category] || []));
    if (!eligibleCategories.has(categoryId)) {
      throw new BadRequestError('This category is not eligible for your current partner categories');
    }
    if (categories.includes(categoryId)) {
      throw new ConflictError('This category is already on your partner profile');
    }

    try {
      return await PartnerCategoryRequest.create({
        profileId: profile._id,
        requester: {
          uid: profile.uid,
          name: profile.name,
          email: profile.email || undefined,
          phone: profile.phone || undefined,
        },
        requestedCategory: categoryId,
        requestedSkills: selectedSkills,
        currentCategories: [...categories],
        workAreas: [...(profile.partnerProfile.workAreas || [])],
        city: profileCity(profile),
        status: 'pending',
      });
    } catch (error: any) {
      if (error?.code === 11000) {
        throw new ConflictError('A request for this category is already pending');
      }
      throw error;
    }
  }

  static async listForPartner(uid: string): Promise<IPartnerCategoryRequest[]> {
    const profile = await Profile.findOne({ uid }).select('_id roles partnerProfile');
    if (
      !profile ||
      !profile.roles?.includes('partner') ||
      !profile.partnerProfile ||
      profile.partnerProfile.status !== 'approved'
    ) {
      throw new ForbiddenError('An approved partner profile is required');
    }
    return (await PartnerCategoryRequest.find({ profileId: profile._id })
      .sort({ createdAt: -1 })
      .lean()) as unknown as IPartnerCategoryRequest[];
  }

  static async listForAdmin(filters: {
    status?: string;
    page?: number;
    limit?: number;
    search?: string;
    requestedCategory?: string;
    currentCategory?: string;
    city?: string;
  }): Promise<{ items: IPartnerCategoryRequest[]; total: number; page: number; limit: number }> {
    const status = filters.status || 'pending';
    if (!['pending', 'approved', 'rejected', 'all'].includes(status)) {
      throw new BadRequestError('Invalid status filter');
    }

    const page = Math.max(1, Number.isFinite(filters.page) ? Number(filters.page) : 1);
    const limit = Math.min(100, Math.max(1, Number.isFinite(filters.limit) ? Number(filters.limit) : 25));
    const query: Record<string, any> = {};
    if (status !== 'all') query.status = status;
    if (filters.requestedCategory) query.requestedCategory = filters.requestedCategory;
    if (filters.currentCategory) query.currentCategories = filters.currentCategory;
    if (filters.city) query.city = new RegExp(escapeRegex(filters.city.trim()), 'i');
    if (filters.search?.trim()) {
      const search = new RegExp(escapeRegex(filters.search.trim()), 'i');
      query.$or = [
        { 'requester.name': search },
        { 'requester.email': search },
        { 'requester.phone': search },
        { 'requester.uid': search },
      ];
    }

    const [items, total] = await Promise.all([
      PartnerCategoryRequest.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      PartnerCategoryRequest.countDocuments(query),
    ]);
    return { items: items as unknown as IPartnerCategoryRequest[], total, page, limit };
  }

  static async review(
    requestId: string,
    status: Exclude<PartnerCategoryRequestStatus, 'pending'>,
    reviewedBy: string,
    reviewNotes?: string,
  ): Promise<IPartnerCategoryRequest> {
    if (!mongoose.isValidObjectId(requestId)) throw new BadRequestError('Invalid requestId');
    if (!['approved', 'rejected'].includes(status)) throw new BadRequestError('Invalid review status');
    if (reviewNotes !== undefined && typeof reviewNotes !== 'string') {
      throw new BadRequestError('reviewNotes must be a string');
    }
    if (reviewNotes && reviewNotes.length > 2000) {
      throw new BadRequestError('reviewNotes must be 2000 characters or fewer');
    }

    const session = await mongoose.startSession();
    let reviewedRequest: IPartnerCategoryRequest | null = null;
    try {
      await session.withTransaction(async () => {
        const request = await PartnerCategoryRequest.findById(requestId).session(session);
        if (!request) throw new NotFoundError('Partner category request not found');
        if (request.status !== 'pending') {
          throw new ConflictError('Only pending requests can be reviewed');
        }

        if (status === 'approved') {
          const profile = await Profile.findById(request.profileId).session(session);
          if (!profile || !profile.partnerProfile) {
            throw new NotFoundError('Partner profile not found');
          }
          profile.partnerProfile.categories = Array.from(
            new Set([...(profile.partnerProfile.categories || []), request.requestedCategory]),
          );
          const skills = (profile.partnerProfile.skills || {}) as Record<string, string[]>;
          const requestedSkills: unknown = request.requestedSkills;
          const approvedSkills = Array.isArray(requestedSkills)
            ? requestedSkills.filter(
                (skillId: unknown): skillId is string => typeof skillId === 'string',
              )
            : [];
          skills[request.requestedCategory] = [...new Set(approvedSkills)];
          profile.partnerProfile.skills = skills;
          profile.markModified('partnerProfile.categories');
          profile.markModified('partnerProfile.skills');
          await profile.save({ session });
        }

        request.status = status;
        request.reviewedBy = reviewedBy;
        request.reviewNotes = reviewNotes?.trim() || undefined;
        request.reviewedAt = new Date();
        await request.save({ session });
        reviewedRequest = request;
      });
    } finally {
      await session.endSession();
    }
    if (!reviewedRequest) throw new ConflictError('Request could not be reviewed');
    return reviewedRequest;
  }
}
