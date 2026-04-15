import Profile, { IProfile, IProfileDocument } from '../models/Profile';
import { ILocation } from '../types';
import { NotFoundError, BadRequestError, InternalServerError } from '../errors/AppError';
import logger from '../config/logger';
import mongoose from 'mongoose';
import { getConnectionStatus } from '../config/database';
import axios from 'axios';
import { validateEnv } from '../config/env';
import { auth } from '../config/firebase';
import { statsService } from './StatsService';

export class ProfileService {
  static async getCertificateReviewQueue(params: {
    page: number;
    limit: number;
    uid?: string;
    q?: string;
    city?: string;
    status?: 'pending' | 'verified' | 'rejected';
  }): Promise<{
    items: any[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }> {
    this.checkConnection();

    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(params.limit) || 20));
    const skip = (page - 1) * limit;
    const status = params.status;
    const uid = params.uid?.trim();
    const q = params.q?.trim();
    const city = params.city?.trim();
    const certificateStatusMatch =
      status === 'pending'
        ? { $in: ['pending', null] }
        : status;

    const profileMatch: any = {
      isActive: true,
      'dataPrivacy.accountDeleted': { $ne: true },
    };
    const andFilters: any[] = [];

    if (uid) {
      andFilters.push({ uid });
    } else if (q && q.length >= 2) {
      const searchRegex = new RegExp(q, 'i');
      andFilters.push({
        $or: [
        { uid: searchRegex },
        { name: searchRegex },
        { email: searchRegex },
        { phone: searchRegex },
        ],
      });
    }

    if (city) {
      const cityRegex = new RegExp(city, 'i');
      andFilters.push({
        $or: [{ 'location.addressDetails.city': cityRegex }, { city: cityRegex }],
      });
    }

    if (andFilters.length > 0) {
      profileMatch.$and = andFilters;
    }

    const pipeline: any[] = [
      { $match: profileMatch },
      { $unwind: { path: '$skills.list', includeArrayIndex: 'skillIndex' } },
      { $unwind: { path: '$skills.list.certificates', includeArrayIndex: 'certificateIndex' } },
      {
        $match: {
          'skills.list.certificates.documentUrl': { $exists: true, $nin: [null, ''] },
          ...(certificateStatusMatch
            ? { 'skills.list.certificates.status': certificateStatusMatch }
            : {}),
        },
      },
      {
        $project: {
          _id: 0,
          uid: '$uid',
          name: '$name',
          email: '$email',
          phone: '$phone',
          city: { $ifNull: ['$location.addressDetails.city', '$city'] },
          skillIndex: '$skillIndex',
          skillName: '$skills.list.name',
          certificateIndex: '$certificateIndex',
          certificate: {
            title: '$skills.list.certificates.title',
            issuedBy: '$skills.list.certificates.issuedBy',
            issuedDate: '$skills.list.certificates.issuedDate',
            uploadedAt: '$skills.list.certificates.uploadedAt',
            documentUrl: '$skills.list.certificates.documentUrl',
            verificationType: '$skills.list.certificates.verificationType',
            certificateType: '$skills.list.certificates.certificateType',
            issuingAuthority: '$skills.list.certificates.issuingAuthority',
            certificateNumber: '$skills.list.certificates.certificateNumber',
            issueDate: '$skills.list.certificates.issueDate',
            expiryDate: '$skills.list.certificates.expiryDate',
            status: '$skills.list.certificates.status',
            reviewedBy: '$skills.list.certificates.reviewedBy',
            reviewedAt: '$skills.list.certificates.reviewedAt',
            rejectionReason: '$skills.list.certificates.rejectionReason',
            reviewNotes: '$skills.list.certificates.reviewNotes',
          },
          sortDate: {
            $ifNull: [
              '$skills.list.certificates.uploadedAt',
              {
                $ifNull: [
                  '$skills.list.certificates.issueDate',
                  {
                    $ifNull: ['$skills.list.certificates.issuedDate', '$updatedAt'],
                  },
                ],
              },
            ],
          },
        },
      },
      { $sort: { sortDate: -1 } },
      {
        $facet: {
          items: [{ $skip: skip }, { $limit: limit }],
          totalCount: [{ $count: 'count' }],
        },
      },
    ];

    const [result] = await Profile.aggregate(pipeline);
    const items = result?.items || [];
    const total = result?.totalCount?.[0]?.count || 0;

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  private static normalizePortfolio(portfolio: any): any[] {
    if (!Array.isArray(portfolio)) {
      return [];
    }

    const now = new Date();

    return portfolio
      .map((item: any) => {
        const title = typeof item?.title === 'string' ? item.title.trim() : '';
        const description = typeof item?.description === 'string' ? item.description.trim() : '';
        const url = typeof item?.url === 'string' ? item.url.trim() : '';
        const images = Array.isArray(item?.images)
          ? item.images
              .map((img: any) => (typeof img === 'string' ? img.trim() : ''))
              .filter(Boolean)
              .slice(0, 8)
          : [];

        if (!title) {
          return null;
        }

        const hasUrl = !!url;
        const hasImages = images.length > 0;
        if (!hasUrl && !hasImages) {
          return null;
        }

        let normalizedUrl: string | undefined;
        if (hasUrl) {
          try {
            const parsed = new URL(url);
            if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
              normalizedUrl = parsed.toString();
            }
          } catch {
            normalizedUrl = undefined;
          }
        }

        if (!normalizedUrl && !hasImages) {
          return null;
        }

        return {
          title,
          description: description || undefined,
          url: normalizedUrl,
          images,
          createdAt: item?.createdAt ? new Date(item.createdAt) : now,
          updatedAt: now,
        };
      })
      .filter(Boolean)
      .slice(0, 10);
  }

  private static normalizeProfilePrivacy(profilePrivacy: any) {
    if (!profilePrivacy || typeof profilePrivacy !== 'object') {
      return null;
    }

    const visibility =
      profilePrivacy.profileVisibility === 'public' ||
      profilePrivacy.profileVisibility === 'registered_users' ||
      profilePrivacy.profileVisibility === 'connections_only'
        ? profilePrivacy.profileVisibility
        : 'registered_users';

    return {
      profileVisibility: visibility,
      showEarnings: Boolean(profilePrivacy.showEarnings),
      showTaskHistory: profilePrivacy.showTaskHistory !== undefined ? Boolean(profilePrivacy.showTaskHistory) : true,
      showReviews: profilePrivacy.showReviews !== undefined ? Boolean(profilePrivacy.showReviews) : true,
      locationSharing: profilePrivacy.locationSharing !== undefined ? Boolean(profilePrivacy.locationSharing) : true,
      analyticsTracking: profilePrivacy.analyticsTracking !== undefined ? Boolean(profilePrivacy.analyticsTracking) : true,
    };
  }

  /**
   * Check MongoDB connection before operations
   */
  private static checkConnection(): void {
    if (!getConnectionStatus() && mongoose.connection.readyState !== 1) {
      logger.error('❌ MongoDB not connected. ReadyState:', mongoose.connection.readyState);
      throw new InternalServerError('Database connection unavailable. Please try again later.');
    }
  }

  /**
   * Get current user's profile
   */
  static async getMyProfile(uid: string): Promise<IProfileDocument> {
    this.checkConnection();
    
    const profile = await Profile.findOne({ uid })
      .select('uid name profession email phone roles userType skills rating totalReviews isVerified isAadhaarVerified aadhaarVerifiedAt maskedAadhaar isEmailVerified emailVerifiedAt isPANVerified panVerifiedAt maskedPan isBankVerified bankVerifiedAt maskedBankAccount bankAccount location photoURL bio portfolio totalTasks completedTasks postedTasks earnedAmount business onboardingStatus profilePrivacy savedAddresses dataPrivacy createdAt updatedAt')
      .lean();

    if (!profile) {
      throw new NotFoundError('Profile not found. Please complete the onboarding process.');
    }

    if ((profile as any).dataPrivacy?.accountDeleted) {
      throw new BadRequestError('This profile is no longer available');
    }

    return profile as unknown as IProfileDocument;
  }

  /**
   * Get profile by UID (public profile)
   */
  static async getProfileByUid(uid: string): Promise<IProfileDocument> {
    const profile = await Profile.findOne({ uid }).lean();

    if (!profile) {
      throw new NotFoundError('Profile not found');
    }

    if ((profile as any).dataPrivacy?.accountDeleted || profile.isActive === false) {
      throw new NotFoundError('This profile is no longer available');
    }

    return profile as unknown as IProfileDocument;
  }

  /**
   * Get profile by ObjectId (for enrichment - minimal fields only)
   */
  static async getProfileById(profileId: string): Promise<{
    _id: mongoose.Types.ObjectId;
    name: string;
    photoURL?: string | null;
    rating?: number;
    totalReviews?: number;
  } | null> {
    this.checkConnection();

    try {
      const objectId = new mongoose.Types.ObjectId(profileId);
      const profile = await Profile.findById(objectId)
        .select('_id name photoURL rating totalReviews')
        .lean();

      if (!profile) {
        return null;
      }

      return {
        _id: profile._id,
        name: profile.name || 'Anonymous',
        photoURL: profile.photoURL || null,
        rating: profile.rating || 0,
        totalReviews: profile.totalReviews || 0,
      };
    } catch (error: any) {
      logger.error('Error fetching profile by ObjectId', {
        profileId,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Get public profile by MongoDB ObjectId (full public profile)
   * Returns the same fields as the user's public profile section
   * Used when accessing profiles by MongoDB ID from the frontend
   */
  static async getPublicProfileById(profileId: string): Promise<IProfileDocument> {
    this.checkConnection();

    try {
      const objectId = new mongoose.Types.ObjectId(profileId);
      const profile = await Profile.findById(objectId)
        .select('_id uid name profession email phone roles userType skills rating totalReviews isVerified isAadhaarVerified aadhaarVerifiedAt isEmailVerified emailVerifiedAt isPANVerified panVerifiedAt maskedPan isBankVerified bankVerifiedAt photoURL bio portfolio location totalTasks completedTasks postedTasks earnedAmount business profilePrivacy dataPrivacy createdAt isActive')
        .lean();

      if (!profile) {
        throw new NotFoundError('Profile not found');
      }

      if ((profile as any).dataPrivacy?.accountDeleted || !profile.isActive) {
        throw new NotFoundError('This profile is no longer available');
      }

      return profile as unknown as IProfileDocument;
    } catch (error: any) {
      if (error instanceof NotFoundError) {
        throw error;
      }
      if (error.name === 'CastError' || error.message.includes('ObjectId')) {
        throw new NotFoundError('Invalid profile ID');
      }
      logger.error('Error fetching public profile by ObjectId', {
        profileId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get multiple profiles by ObjectIds (batch - for enrichment)
   * Returns minimal fields: _id, name, photoURL, rating, totalReviews
   */
  static async getProfilesBatch(profileIds: string[]): Promise<Map<string, {
    _id: mongoose.Types.ObjectId;
    uid?: string;
    name: string;
    photoURL?: string | null;
    rating?: number;
    totalReviews?: number;
    isVerified?: boolean;
    isAadhaarVerified?: boolean;
    isPANVerified?: boolean;
    isBankVerified?: boolean;
  }>> {
    this.checkConnection();

    const profileMap = new Map();

    if (!profileIds || profileIds.length === 0) {
      return profileMap;
    }

    try {
      const objectIds = profileIds
        .filter(id => id && mongoose.Types.ObjectId.isValid(id))
        .map(id => new mongoose.Types.ObjectId(id));

      if (objectIds.length === 0) {
        return profileMap;
      }

      const profiles = await Profile.find({ _id: { $in: objectIds } })
        .select('_id uid name photoURL rating totalReviews isVerified isAadhaarVerified isPANVerified isBankVerified')
        .lean();

      profiles.forEach(profile => {
        profileMap.set(profile._id.toString(), {
          _id: profile._id,
          uid: profile.uid,
          name: profile.name || 'Anonymous',
          photoURL: profile.photoURL || null,
          rating: profile.rating || 0,
          totalReviews: profile.totalReviews || 0,
          isVerified: profile.isVerified || false,
          isAadhaarVerified: profile.isAadhaarVerified || false,
          isPANVerified: profile.isPANVerified || false,
          isBankVerified: profile.isBankVerified || false,
        });
      });

      return profileMap;
    } catch (error: any) {
      logger.error('Error batch fetching profiles by ObjectId', {
        profileIdsCount: profileIds.length,
        error: error.message,
      });
      return profileMap;
    }
  }

  /**
   * Search profiles
   */
  static async searchProfiles(query: string, limit: number = 10, excludeUid?: string): Promise<IProfileDocument[]> {
    if (!query || query.trim().length < 2) {
      throw new BadRequestError('Search query must be at least 2 characters');
    }

    const searchQuery: any = {
      isActive: true,
      'dataPrivacy.accountDeleted': { $ne: true },
      $or: [
        { name: { $regex: query.trim(), $options: 'i' } },
        { email: { $regex: query.trim(), $options: 'i' } },
        { phone: { $regex: query.trim(), $options: 'i' } }
      ]
    };

    if (excludeUid) {
      searchQuery.uid = { $ne: excludeUid };
    }

    const profiles = await Profile.find(searchQuery)
      .select('uid name profession email phone roles userType skills rating totalReviews isVerified isAadhaarVerified aadhaarVerifiedAt location')
      .limit(limit)
      .lean();

    return profiles as unknown as IProfileDocument[];
  }

  /**
   * Find users with matching skill category
   * For service-to-service calls from task-service
   * Used when a task is created to find taskers with matching skills
   * 
   * @param category - Task category (e.g., 'cleaning', 'repair')
   * @returns Promise<string[]> Array of user UIDs with matching skills
   */
  static async findUsersBySkillCategory(category: string): Promise<string[]> {
    this.checkConnection();
    
    if (!category || category.trim().length === 0) {
      logger.warn('ProfileService.findUsersBySkillCategory: Empty category provided');
      return [];
    }

    try {
      const sanitizeCategoryText = (value: string): string =>
        value
          .toLowerCase()
          .trim()
          .replace(/[\|,&]+/g, ' ')
          .replace(/\s+/g, ' ');

      const normalizedCategory = sanitizeCategoryText(category);
      const compactCategory = normalizedCategory.replace(/[\s/\-]+/g, '_');

      const categoryAliasMap: Record<string, string[]> = {
        cleaning: ['cleaning', 'house_cleaning', 'home_cleaning', 'deep_cleaning', 'maid', 'housekeeping', 'car_wash', 'car_washing', 'laundry'],
        repair: ['repair', 'handyperson', 'handyman', 'plumbing', 'electrical', 'carpentry', 'painting', 'appliances', 'it_support', 'laptop_repair', 'computer_repair', 'device_repair'],
        it_support: ['it_support', 'tech_support', 'computer_repair', 'laptop_repair', 'software_installation', 'network_setup'],
        delivery: ['delivery', 'courier', 'moving', 'removals', 'driving', 'driver'],
        assembly: ['assembly', 'furniture_assembly', 'installation', 'mounting'],
        gardening: ['gardening', 'landscaping', 'lawn_care', 'tree_services'],
        petcare: ['petcare', 'pet_care', 'pet_services', 'pet_sitting', 'dog_walking', 'pet_grooming'],
        other: ['other'],
      };

      const slashSegments = normalizedCategory
        .split(/[\//]+/)
        .map((token) => token.trim())
        .filter(Boolean);

      const wordSegments = normalizedCategory
        .split(/[\s/\-]+/)
        .map((token) => token.trim())
        .filter((token) => token.length > 2);

      const aliasSeedTokens = Array.from(new Set([compactCategory, ...slashSegments.map((segment) => segment.replace(/[\s\-]+/g, '_'))]));
      const aliasTokens = aliasSeedTokens.flatMap((token) => categoryAliasMap[token] || []);

      const rawTokens = [
        normalizedCategory,
        compactCategory,
        compactCategory.replace(/_/g, '-'),
        compactCategory.replace(/_/g, ' '),
        ...slashSegments,
        ...wordSegments,
        ...aliasTokens,
      ];
      const tokens = Array.from(
        new Set(
          rawTokens
            .map((token) => token.toLowerCase().trim().replace(/[\s/\-]+/g, '_'))
            .filter((token) => token.length > 0)
        )
      );

      const escapedTokens = tokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      const exactTokenRegexes = escapedTokens.map(
        (token) => new RegExp(`^${token.replace(/_/g, '[\\s_\\-/]+')}$`, 'i')
      );

      const regexTerms = tokens
        .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .map((token) => token.replace(/_/g, '[\\s_\\-/]+'));
      const tokenRegex = new RegExp(`(${regexTerms.join('|')})`, 'i');

      const users = await Profile.find({
        roles: { $in: ['tasker', 'both'] },
        isActive: true,
        $or: [
          { 'skills.primaryCategory': { $in: tokens } },
          { 'skills.primaryCategory': { $in: exactTokenRegexes } },
          { 'skills.list.category': { $in: tokens } },
          { 'skills.list.category': { $in: exactTokenRegexes } },
          { 'skills.list.name': tokenRegex },
        ],
      })
        .select('uid skills.primaryCategory skills.list.name skills.list.category')
        .lean();

      const userIds = Array.from(
        new Set(
          users
            .map((u: any) => u.uid)
            .filter((uid): uid is string => typeof uid === 'string' && uid.trim().length > 0)
        )
      );

      logger.info('ProfileService: Found users by skill category', {
        inputCategory: category,
        normalizedCategory: compactCategory,
        searchTokens: tokens,
        filters: {
          roles: ['tasker', 'both'],
          isActive: true,
          isVerified: 'not-required',
        },
        count: userIds.length
      });

      return userIds;
    } catch (error) {
      logger.error('ProfileService.findUsersBySkillCategory error:', {
        category,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }

  /**
   * Find users with any of the provided keywords
   * For service-to-service calls from task-service
   * Used when a task is created to find users interested in the keywords
   * 
   * @param keywords - Array of keywords to search for
   * @returns Promise<string[]> Array of user UIDs with matching keywords
   */
  static async findUsersByAnyKeyword(keywords: string[]): Promise<string[]> {
    this.checkConnection();
    
    if (!keywords || keywords.length === 0) {
      logger.warn('ProfileService.findUsersByAnyKeyword: Empty keywords provided');
      return [];
    }

    try {
      const normalizedKeywords = keywords
        .map(k => (typeof k === 'string' ? k.toLowerCase().trim() : ''))
        .filter(k => k.length > 0);

      if (normalizedKeywords.length === 0) {
        return [];
      }

      // Build an OR query that matches:
      // 1. Exact keyword match (e.g., user saved "plumbing", task has "plumbing")
      // 2. Partial word match (e.g., user saved "home cleaning", task has ["home", "cleaning"])
      // This ensures multi-word keywords like "home cleaning" match tasks with those words
      const orConditions = normalizedKeywords.map(keyword => ({
        'savedKeywords.keywords': {
          $regex: new RegExp(`\\b${keyword}\\b`, 'i') // Word boundary match
        }
      }));

      const users = await Profile.find({
        isActive: true,
        $or: orConditions
      })
        .select('uid')
        .lean();

      // Remove duplicates (same user might match multiple keywords)
      const uniqueUserIds = [...new Set(users.map((u: any) => u.uid))];

      logger.info('ProfileService: Found users by keywords', {
        keywordCount: keywords.length,
        userCount: uniqueUserIds.length,
        keywords: normalizedKeywords.slice(0, 5) // Log first 5 for debugging
      });

      return uniqueUserIds;
    } catch (error) {
      logger.error('ProfileService.findUsersByAnyKeyword error:', {
        keywordCount: keywords.length,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }

  /**
   * Find users with any of the provided category slugs
   * For service-to-service calls from task-service
   * Used when a task is created to find users interested in those categories
   * 
   * @param categorySlugs - Array of category slugs to search for
   * @returns Promise<string[]> Array of user UIDs with matching categories
   */
  static async findUsersByAnyCategory(categorySlugs: string[]): Promise<string[]> {
    this.checkConnection();
    
    if (!categorySlugs || categorySlugs.length === 0) {
      logger.warn('ProfileService.findUsersByAnyCategory: Empty category slugs provided');
      return [];
    }

    try {
      const normalizedSlugs = categorySlugs
        .map((slug) => (typeof slug === 'string' ? slug.toLowerCase().trim() : ''))
        .filter((slug) => slug.length > 0);

      if (normalizedSlugs.length === 0) {
        return [];
      }

      const users = await Profile.find({
        isActive: true,
        'savedCategories.categories.slug': {
          $in: normalizedSlugs
        }
      })
        .select('uid')
        .lean();

      const userIds = users.map((u: any) => u.uid);
      logger.info('ProfileService: Found users by categories', {
        categoryCount: categorySlugs.length,
        userCount: userIds.length
      });

      return userIds;
    } catch (error) {
      logger.error('ProfileService.findUsersByAnyCategory error:', {
        categoryCount: categorySlugs.length,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }

  /**
   * Create or update profile
   */
  static async upsertProfile(uid: string, profileData: Partial<IProfile>): Promise<IProfileDocument> {
    this.checkConnection();
    
    console.log('💾 [PROFILE SERVICE] upsertProfile called', {
      uid,
      profileData: {
        name: profileData.name,
        email: profileData.email,
        phone: profileData.phone ? 'present' : 'not present',
        roles: profileData.roles,
        hasLocation: !!profileData.location,
        hasSkills: !!profileData.skills
      }
    });

    const now = Date.now();

    // Process location data
    let processedLocation: ILocation | null = null;
    if (profileData.location && profileData.location.coordinates) {
      processedLocation = {
        type: 'Point',
        coordinates: profileData.location.coordinates,
        address: profileData.location.address || null,
        addressDetails: profileData.location.addressDetails || {},
        isPublic: true
      };
    }

    // Build payload
    const payload: any = {
      uid,
      updatedAt: now
    };

    const existingProfile = await Profile.findOne({ uid }).lean();

    if (profileData.name) payload.name = profileData.name;
    if (profileData.profession !== undefined) payload.profession = profileData.profession;
    if (profileData.email !== undefined) payload.email = profileData.email;
    if (profileData.phone !== undefined) payload.phone = profileData.phone;
    if (profileData.roles) payload.roles = profileData.roles;
    if (profileData.userType) payload.userType = profileData.userType;
    if (processedLocation) payload.location = processedLocation;
    if (profileData.savedAddresses !== undefined) {
      // Ensure each address has proper structure with validation
      payload.savedAddresses = Array.isArray(profileData.savedAddresses)
        ? profileData.savedAddresses
            .filter((addr: any) => {
              // Filter out addresses with empty address field (required by schema)
              return addr.address && String(addr.address).trim().length > 0;
            })
            .map((addr: any) => {
              // Validate and normalize label (must be one of: 'Home', 'Work', 'Other')
              const validLabels = ['Home', 'Work', 'Other'];
              const normalizedLabel = validLabels.includes(addr.label) 
                ? addr.label 
                : 'Other';

              // Validate and normalize coordinates
              let normalizedCoordinates: [number, number] = [0, 0];
              if (Array.isArray(addr.coordinates) && addr.coordinates.length >= 2) {
                const lng = typeof addr.coordinates[0] === 'number' 
                  ? addr.coordinates[0] 
                  : parseFloat(String(addr.coordinates[0]));
                const lat = typeof addr.coordinates[1] === 'number' 
                  ? addr.coordinates[1] 
                  : parseFloat(String(addr.coordinates[1]));
                if (!isNaN(lng) && !isNaN(lat) && isFinite(lng) && isFinite(lat)) {
                  normalizedCoordinates = [lng, lat];
                }
              }

              return {
                label: normalizedLabel,
                address: String(addr.address).trim(),
                coordinates: normalizedCoordinates,
                city: addr.city || undefined,
                state: addr.state || undefined,
                country: addr.country || 'India',
                addressDetails: addr.addressDetails || {},
                name: addr.name || undefined,
                phone: addr.phone || undefined,
                isDefault: addr.isDefault || false,
                createdAt: addr.createdAt ? new Date(addr.createdAt) : new Date(),
              };
            })
        : [];
    }
    if (profileData.skills) {
      payload.skills = {
        ...profileData.skills,
        list: Array.isArray(profileData.skills.list)
          ? profileData.skills.list.map((s: any) => ({
              ...s,
              name: String(s.name).toLowerCase().trim()
            })).slice(0, 50)
          : []
      };
    }
    if (profileData.photoURL !== undefined) payload.photoURL = profileData.photoURL;
    if (profileData.bio !== undefined) payload.bio = profileData.bio;
    if (profileData.portfolio !== undefined) payload.portfolio = this.normalizePortfolio(profileData.portfolio);
    if (profileData.business !== undefined || profileData.bio !== undefined) {
      const mergedBusiness: any = {
        ...(existingProfile?.business ? (existingProfile.business as any) : {}),
        ...(profileData.business ? (profileData.business as any) : {}),
      };

      if (profileData.bio !== undefined) {
        mergedBusiness.description = profileData.bio;
      }

      if (Object.keys(mergedBusiness).length > 0) {
        payload.business = mergedBusiness;
      }
    }
    if (profileData.profilePrivacy !== undefined) {
      const normalizedProfilePrivacy = this.normalizeProfilePrivacy(profileData.profilePrivacy);
      if (normalizedProfilePrivacy) {
        payload.profilePrivacy = normalizedProfilePrivacy;
      }
    }
    if (profileData.agreeUpdates !== undefined) payload.agreeUpdates = profileData.agreeUpdates;
    if (profileData.agreeTerms !== undefined) payload.agreeTerms = profileData.agreeTerms;

    console.log('🔍 [PROFILE SERVICE] Checking if profile exists', {
      uid,
      exists: !!existingProfile,
      existingProfileId: existingProfile?._id?.toString()
    });
    
    if (!existingProfile) {
      payload.createdAt = now;
      console.log('✨ [PROFILE SERVICE] Creating new profile', { uid, payload: { ...payload, location: payload.location ? 'present' : 'not present' } });
    } else {
      console.log('🔄 [PROFILE SERVICE] Updating existing profile', { uid, existingProfileId: existingProfile._id?.toString() });
    }

    // Update onboarding status
    // ✨ CRITICAL: If frontend explicitly provides onboardingStatus, use it (trust the frontend)
    // Otherwise, calculate it based on data
    if (profileData.onboardingStatus) {
      // Frontend is explicitly setting onboarding status - trust it
      payload.onboardingStatus = {
        isCompleted: profileData.onboardingStatus.isCompleted || false,
        completedSteps: profileData.onboardingStatus.completedSteps || {
          roles: false,
          profile: false
        },
        completedAt: profileData.onboardingStatus.completedAt 
          ? (typeof profileData.onboardingStatus.completedAt === 'string' 
              ? new Date(profileData.onboardingStatus.completedAt).getTime() 
              : profileData.onboardingStatus.completedAt)
          : (profileData.onboardingStatus.isCompleted ? now : null),
        lastStep: profileData.onboardingStatus.lastStep || 'roles'
      };
      console.log('✅ [PROFILE SERVICE] Using onboardingStatus from frontend:', payload.onboardingStatus);
    } else {
      // No onboardingStatus provided - calculate it based on data
      // ✨ REMOVED: Location check - location is completely removed from onboarding
      const hasRoles = Array.isArray(profileData.roles) && profileData.roles.length > 0;
      const hasName = !!profileData.name;
      const hasEmail = !!profileData.email;

      const currentOnboardingStatus = existingProfile?.onboardingStatus || {
        isCompleted: false,
        completedSteps: { roles: false, profile: false },
        lastStep: 'roles',
        completedAt: null
      };

      const updatedCompletedSteps = {
        roles: hasRoles || currentOnboardingStatus.completedSteps.roles,
        profile: (hasName && hasEmail) || currentOnboardingStatus.completedSteps.profile
      };

      // ✨ Only require roles for onboarding completion
      // Location and Aadhaar verification completely removed from onboarding (only in VerificationDashboard)
      const isOnboardingComplete = updatedCompletedSteps.roles;

      let lastStep = currentOnboardingStatus.lastStep;
      if (hasRoles) lastStep = 'roles';
      if (hasName && hasEmail) lastStep = 'profile';

      payload.onboardingStatus = {
        isCompleted: isOnboardingComplete,
        completedSteps: updatedCompletedSteps,
        completedAt: isOnboardingComplete ? now : null,
        lastStep
      };
      console.log('🔄 [PROFILE SERVICE] Calculated onboardingStatus from data:', payload.onboardingStatus);
    }

    console.log('💾 [PROFILE SERVICE] Saving profile to MongoDB', {
      uid,
      operation: existingProfile ? 'update' : 'create',
      payloadKeys: Object.keys(payload)
    });
    
    const updateResult = await Profile.updateOne({ uid }, { $set: payload }, { upsert: true });
    
    console.log('✅ [PROFILE SERVICE] Profile saved to MongoDB', {
      uid,
      matchedCount: updateResult.matchedCount,
      modifiedCount: updateResult.modifiedCount,
      upsertedCount: updateResult.upsertedCount,
      upsertedId: updateResult.upsertedId?.toString(),
      acknowledged: updateResult.acknowledged
    });

    const savedProfile = await Profile.findOne({ uid }).lean();
    if (!savedProfile) {
      console.error('❌ [PROFILE SERVICE] Profile was saved but could not be retrieved', { uid });
      throw new Error('Profile was saved but could not be retrieved');
    }
    
    console.log('✅ [PROFILE SERVICE] Profile retrieved after save', {
      uid,
      profileId: savedProfile._id?.toString(),
      hasRoles: !!savedProfile.roles && savedProfile.roles.length > 0,
      onboardingStatus: savedProfile.onboardingStatus
    });

    return savedProfile as unknown as IProfileDocument;
  }

  /**
   * Update profile
   */
  static async updateProfile(uid: string, profileData: Partial<IProfile>): Promise<IProfileDocument> {
    console.log('🔍 [PROFILE SERVICE] Finding profile to update', { uid });
    
    const existingProfile = await Profile.findOne({ uid }).lean();
    if (!existingProfile) {
      console.error('❌ [PROFILE SERVICE] Profile not found', { uid });
      throw new NotFoundError('Profile not found. Please create a profile first.');
    }
    
    console.log('✅ [PROFILE SERVICE] Found existing profile', {
      uid,
      currentIsAadhaarVerified: existingProfile.isAadhaarVerified,
      currentAadhaarVerifiedAt: existingProfile.aadhaarVerifiedAt,
      currentIsPANVerified: existingProfile.isPANVerified,
      currentPANVerifiedAt: existingProfile.panVerifiedAt,
      updateData: {
        isAadhaarVerified: profileData.isAadhaarVerified,
        aadhaarVerifiedAt: profileData.aadhaarVerifiedAt,
        isPANVerified: profileData.isPANVerified,
        panVerifiedAt: profileData.panVerifiedAt
      }
    });

    const now = Date.now();
    const updatePayload: any = { updatedAt: now };

    // Process location if provided
    if (profileData.location) {
      if (profileData.location.coordinates && Array.isArray(profileData.location.coordinates) && profileData.location.coordinates.length === 2) {
        updatePayload.location = {
          type: 'Point',
          coordinates: profileData.location.coordinates,
          address: profileData.location.address || null,
          addressDetails: profileData.location.addressDetails || {},
          isPublic: true
        };
      }
    }

    // Update fields
    if (profileData.name !== undefined) updatePayload.name = profileData.name;
    if (profileData.profession !== undefined) updatePayload.profession = profileData.profession;
    if (profileData.email !== undefined) updatePayload.email = profileData.email;
    if (profileData.phone !== undefined) updatePayload.phone = profileData.phone;
    if (profileData.photoURL !== undefined) updatePayload.photoURL = profileData.photoURL;
    if (profileData.roles !== undefined) updatePayload.roles = profileData.roles;
    if (profileData.userType !== undefined) updatePayload.userType = profileData.userType;
    if (profileData.bio !== undefined) updatePayload.bio = profileData.bio;
    if (profileData.portfolio !== undefined) updatePayload.portfolio = this.normalizePortfolio(profileData.portfolio);
    
    // ✨ LOG: Aadhaar verification fields
    if (profileData.isAadhaarVerified !== undefined) {
      updatePayload.isAadhaarVerified = profileData.isAadhaarVerified;
      console.log('📝 [PROFILE SERVICE] Setting isAadhaarVerified', {
        uid,
        value: profileData.isAadhaarVerified,
        previousValue: existingProfile.isAadhaarVerified
      });
    }
    if (profileData.aadhaarVerifiedAt !== undefined) {
      updatePayload.aadhaarVerifiedAt = profileData.aadhaarVerifiedAt;
      console.log('📝 [PROFILE SERVICE] Setting aadhaarVerifiedAt', {
              previousValue: existingProfile.aadhaarVerifiedAt
      });
    }
    if (profileData.maskedAadhaar !== undefined) {
      updatePayload.maskedAadhaar = profileData.maskedAadhaar;
    }
    
    // ✨ Bank verification fields
    if (profileData.isBankVerified !== undefined) {
      updatePayload.isBankVerified = profileData.isBankVerified;
      console.log('📝 [PROFILE SERVICE] Setting isBankVerified', {
        uid,
        value: profileData.isBankVerified,
        previousValue: existingProfile.isBankVerified
      });
    }
    if (profileData.bankVerifiedAt !== undefined) {
      updatePayload.bankVerifiedAt = profileData.bankVerifiedAt;
      console.log('📝 [PROFILE SERVICE] Setting bankVerifiedAt', {
        uid,
        value: profileData.bankVerifiedAt,
        previousValue: existingProfile.bankVerifiedAt
      });
    }
    if (profileData.maskedBankAccount !== undefined) {
      updatePayload.maskedBankAccount = profileData.maskedBankAccount;
    }
    if (profileData.bankAccount !== undefined) {
      updatePayload.bankAccount = profileData.bankAccount;
    }

    // ✨ PAN verification fields
    if (profileData.isPANVerified !== undefined) {
      updatePayload.isPANVerified = profileData.isPANVerified;
      console.log('📝 [PROFILE SERVICE] Setting isPANVerified', {
        uid,
        value: profileData.isPANVerified,
        previousValue: existingProfile.isPANVerified
      });
    }
    if (profileData.panVerifiedAt !== undefined) {
      updatePayload.panVerifiedAt = profileData.panVerifiedAt;
      console.log('📝 [PROFILE SERVICE] Setting panVerifiedAt', {
        uid,
        value: profileData.panVerifiedAt,
        previousValue: existingProfile.panVerifiedAt
      });
    }
    if (profileData.maskedPan !== undefined) {
      updatePayload.maskedPan = profileData.maskedPan;
    }
    
    // ✨ Email verification fields
    if (profileData.isEmailVerified !== undefined) {
      updatePayload.isEmailVerified = profileData.isEmailVerified;
      console.log('📝 [PROFILE SERVICE] Setting isEmailVerified', {
        uid,
        value: profileData.isEmailVerified,
        previousValue: existingProfile.isEmailVerified
      });
    }
    if (profileData.emailVerifiedAt !== undefined) {
      updatePayload.emailVerifiedAt = profileData.emailVerifiedAt;
      console.log('📝 [PROFILE SERVICE] Setting emailVerifiedAt', {
        uid,
        value: profileData.emailVerifiedAt,
        previousValue: existingProfile.emailVerifiedAt
      });
    }
    
    if (profileData.skills !== undefined) {
      updatePayload.skills = {
        ...profileData.skills,
        list: Array.isArray(profileData.skills.list)
          ? profileData.skills.list.map((s: any) => ({
              ...s,
              name: String(s.name).toLowerCase().trim()
            })).slice(0, 50)
          : []
      };
    }
    if (profileData.savedAddresses !== undefined) {
      // Process savedAddresses exactly like upsertProfile for consistency
      updatePayload.savedAddresses = Array.isArray(profileData.savedAddresses)
        ? profileData.savedAddresses
            .filter((addr: any) => {
              // Filter out addresses with empty address field (required by schema)
              return addr.address && String(addr.address).trim().length > 0;
            })
            .map((addr: any) => {
              // Validate and normalize label (must be one of: 'Home', 'Work', 'Other')
              const validLabels = ['Home', 'Work', 'Other'];
              const normalizedLabel = validLabels.includes(addr.label) 
                ? addr.label 
                : 'Other';

              // Validate and normalize coordinates
              let normalizedCoordinates: [number, number] = [0, 0];
              if (Array.isArray(addr.coordinates) && addr.coordinates.length >= 2) {
                const lng = typeof addr.coordinates[0] === 'number' 
                  ? addr.coordinates[0] 
                  : parseFloat(String(addr.coordinates[0]));
                const lat = typeof addr.coordinates[1] === 'number' 
                  ? addr.coordinates[1] 
                  : parseFloat(String(addr.coordinates[1]));
                if (!isNaN(lng) && !isNaN(lat) && isFinite(lng) && isFinite(lat)) {
                  normalizedCoordinates = [lng, lat];
                }
              }

              // Build base address object
              const addressObj: any = {
                label: normalizedLabel,
                address: String(addr.address).trim(), // Ensure it's a string and trimmed
                coordinates: normalizedCoordinates,
                city: addr.city || undefined,
                state: addr.state || undefined,
                country: addr.country || 'India',
                addressDetails: addr.addressDetails || {},
                name: addr.name || undefined,
                phone: addr.phone || undefined,
                isDefault: addr.isDefault || false,
              };

              // Preserve _id if it exists and is valid (for existing addresses)
              if (addr._id) {
                try {
                  if (addr._id instanceof mongoose.Types.ObjectId) {
                    addressObj._id = addr._id;
                  } else if (typeof addr._id === 'string' && /^[0-9a-fA-F]{24}$/.test(addr._id)) {
                    addressObj._id = new mongoose.Types.ObjectId(addr._id);
                  }
                  // If invalid, Mongoose will generate a new one (don't include _id)
                } catch (error) {
                  // Invalid _id, Mongoose will generate new one
                  logger.warn('Invalid _id in savedAddress, will generate new one', { addressId: addr._id });
                }
              }

              // Preserve createdAt if provided, otherwise Mongoose will set default
              if (addr.createdAt) {
                try {
                  addressObj.createdAt = new Date(addr.createdAt);
                } catch (error) {
                  // Invalid date, Mongoose will set default
                }
              }

              return addressObj;
            })
        : [];
    }
    if (profileData.business !== undefined || profileData.bio !== undefined) {
      const mergedBusiness: any = {
        ...(existingProfile.business ? (existingProfile.business as any) : {}),
        ...(profileData.business ? (profileData.business as any) : {}),
      };

      if (profileData.bio !== undefined) {
        mergedBusiness.description = profileData.bio;
      }

      if (Object.keys(mergedBusiness).length > 0) {
        updatePayload.business = mergedBusiness;
      }
    }
    if (profileData.profilePrivacy !== undefined) {
      const normalizedProfilePrivacy = this.normalizeProfilePrivacy(profileData.profilePrivacy);
      if (normalizedProfilePrivacy) {
        updatePayload.profilePrivacy = normalizedProfilePrivacy;
      }
    }
    if (profileData.agreeUpdates !== undefined) updatePayload.agreeUpdates = profileData.agreeUpdates;
    if (profileData.agreeTerms !== undefined) updatePayload.agreeTerms = profileData.agreeTerms;

    // Update onboarding status
    // ✨ REMOVED: Location check - location is completely removed from onboarding
    const hasRoles = (profileData.roles && Array.isArray(profileData.roles) && profileData.roles.length > 0) || existingProfile.roles;
    const hasName = !!((profileData.name !== undefined && profileData.name) || existingProfile.name);
    const hasEmail = !!((profileData.email !== undefined && profileData.email) || existingProfile.email);

    const currentOnboardingStatus = existingProfile.onboardingStatus || {
      isCompleted: false,
      completedSteps: { roles: false, profile: false },
      lastStep: 'roles',
      completedAt: null
    };

    const updatedCompletedSteps = {
      roles: !!hasRoles || currentOnboardingStatus.completedSteps.roles,
      profile: (hasName && hasEmail) || currentOnboardingStatus.completedSteps.profile
    };

    // ✨ Only require roles for onboarding completion
    // Location and Aadhaar verification completely removed from onboarding (only in VerificationDashboard)
    const isOnboardingComplete = updatedCompletedSteps.roles;

    let lastStep = currentOnboardingStatus.lastStep;
    if (profileData.roles && Array.isArray(profileData.roles) && profileData.roles.length > 0) lastStep = 'roles';
    if (profileData.name && profileData.email) lastStep = 'profile';

    updatePayload.onboardingStatus = {
      isCompleted: isOnboardingComplete,
      completedSteps: updatedCompletedSteps,
      completedAt: isOnboardingComplete ? (currentOnboardingStatus.completedAt || now) : null,
      lastStep
    };

    // ✨ LOG: Before MongoDB update
    console.log('💾 [MONGODB] Updating profile in MongoDB', {
      uid,
      updatePayload: {
        ...updatePayload,
        // Don't log full objects, just keys
        location: updatePayload.location ? 'present' : 'not present',
        skills: updatePayload.skills ? 'present' : 'not present',
        business: updatePayload.business ? 'present' : 'not present'
      }
    });

    try {
      // Use findOneAndUpdate instead of updateOne for better validation support
      const updatedProfile = await Profile.findOneAndUpdate(
        { uid },
        { $set: updatePayload },
        { 
          new: true, 
          runValidators: true,
          setDefaultsOnInsert: true
        }
      ).lean();
      
      // ✨ LOG: After MongoDB update
      logger.info('✅ [PROFILE SERVICE] Profile updated in MongoDB', {
        uid,
        hasUpdatedProfile: !!updatedProfile,
        savedAddressesCount: updatedProfile?.savedAddresses?.length || 0
      });
      
      if (!updatedProfile) {
        throw new NotFoundError('Profile not found after update attempt');
      }

      return updatedProfile as unknown as IProfileDocument;
    } catch (error: any) {
      logger.error('❌ [PROFILE SERVICE] Error updating profile', {
        uid,
        error: error.message,
        errorName: error.name,
        errorCode: error.code,
        errorStack: error.stack?.substring(0, 1000),
        fieldsBeingUpdated: Object.keys(updatePayload),
        savedAddressesInfo: updatePayload.savedAddresses ? {
          count: updatePayload.savedAddresses.length,
          firstAddress: updatePayload.savedAddresses[0] ? {
            label: updatePayload.savedAddresses[0].label,
            addressLength: updatePayload.savedAddresses[0].address?.length || 0,
            hasCoordinates: Array.isArray(updatePayload.savedAddresses[0].coordinates),
            coordinatesLength: updatePayload.savedAddresses[0].coordinates?.length,
            coordinates: updatePayload.savedAddresses[0].coordinates,
            hasAddressDetails: !!updatePayload.savedAddresses[0].addressDetails
          } : null
        } : null
      });
      throw error;
    }
  }

  /**
   * Bulk delete profiles from MongoDB (optimized with deleteMany)
   * Note: This does NOT handle cascade deletion or Firebase deletion
   * Those should be handled separately before calling this method
   */
  static async bulkDeleteProfiles(uids: string[]): Promise<{ deletedCount: number }> {
    if (!uids || uids.length === 0) {
      return { deletedCount: 0 };
    }

    if (uids.length > 1000) {
      throw new Error('Maximum 1000 UIDs per bulk delete operation');
    }

    try {
      const deleteResult = await Profile.deleteMany({ uid: { $in: uids } });
      
      logger.info(`✅ Bulk deleted ${deleteResult.deletedCount} profiles from MongoDB`, {
        requested: uids.length,
        deleted: deleteResult.deletedCount
      });

      return { deletedCount: deleteResult.deletedCount };
    } catch (error: any) {
      logger.error('❌ Bulk profile delete failed:', error);
      throw error;
    }
  }

  /** 
   * Delete profile and all associated data
   */
  static async deleteProfile(uid: string): Promise<{ deletedCount: number; cascadeDeleteResult?: any }> {
    const env = validateEnv();
    
    logger.info(`🗑️ Starting profile deletion for user: ${uid}`);

    try {
      // Resolve profileId (ObjectId) for task-service cascade - tasks use profileId, not uid
      const profile = await Profile.findOne({ uid }).select('_id').lean();
      const profileId = profile?._id?.toString();

      // Step 1: Delete all associated data in Task Service (cascading delete)
      let cascadeDeleteResult = null;
      if (env.TASK_SERVICE_URL && env.SERVICE_AUTH_TOKEN) {
        try {
          logger.info(`📞 Calling Task Service to delete user data: ${uid}${profileId ? ` (profileId: ${profileId})` : ''}`);
          const headers: Record<string, string> = {
            'X-Service-Auth': env.SERVICE_AUTH_TOKEN,
            'X-Service-Name': 'user-service',
            'X-User-Id': uid,
          };
          if (profileId) headers['X-Profile-Id'] = profileId;

          const taskServiceUrl = env.TASK_SERVICE_URL;
          const response = await axios.delete(
            `${taskServiceUrl}/api/v1/cascade-delete/user/${uid}`,
            {
              headers,
              timeout: 30000 // 30 second timeout for cascade delete
            }
          );

          if (response.data && response.data.success) {
            cascadeDeleteResult = response.data.data;
            logger.info(`✅ Task Service cascade delete completed:`, cascadeDeleteResult);
          }
        } catch (error: any) {
          // Log error but don't fail the profile deletion
          // This allows profile deletion even if Task Service is unavailable
          logger.error(`⚠️ Failed to delete user data in Task Service:`, {
            error: error.message,
            status: error.response?.status,
            data: error.response?.data
          });
          
          // If it's a critical error (not just service unavailable), you might want to throw
          // For now, we'll continue with profile deletion
          if (error.response?.status === 404) {
            logger.info(`ℹ️ User has no data in Task Service, continuing with profile deletion`);
          }
        }
      } else {
        logger.warn(`⚠️ TASK_SERVICE_URL or SERVICE_AUTH_TOKEN not configured, skipping cascade delete`);
      }

      // Step 2: Delete the profile
      const deleteResult = await Profile.deleteOne({ uid });

      if (deleteResult.deletedCount === 0) {
        throw new NotFoundError('Profile not found');
      }

      logger.info(`✅ Profile deleted successfully: ${uid}`);

      // Step 3: Delete Firebase account using Admin SDK (no recent auth required)
      try {
        logger.info(`🗑️ Deleting Firebase account for user: ${uid}`);
        await auth.deleteUser(uid);
        logger.info(`✅ Firebase account deleted successfully: ${uid}`);
      } catch (firebaseError: any) {
        // Log error but don't fail - profile is already deleted
        // Firebase account deletion failure is not critical since profile is gone
        logger.error(`⚠️ Failed to delete Firebase account for user ${uid}:`, {
          error: firebaseError.message,
          code: firebaseError.code
        });
        
        // If user doesn't exist in Firebase, that's okay - continue
        if (firebaseError.code === 'auth/user-not-found') {
          logger.info(`ℹ️ Firebase user ${uid} not found (may have been deleted already)`);
        }
      }

      return { 
        deletedCount: deleteResult.deletedCount,
        cascadeDeleteResult 
      };
    } catch (error: any) {
      logger.error(`❌ Error deleting profile for user ${uid}:`, error);
      throw error;
    }
  }

  /**
   * Get profile completion percentage
   */
  static async getProfileCompletion(uid: string): Promise<any> {
    const profile = await Profile.findOne({ uid }).lean();
    if (!profile) {
      throw new NotFoundError('Profile not found');
    }

    // Use static method from Profile model (TypeScript doesn't recognize statics properly)
    const ProfileModel = Profile as any;
    if (ProfileModel.calculateCompletionPercentage) {
      return ProfileModel.calculateCompletionPercentage(profile as unknown as IProfileDocument);
    }
    // Fallback if static method not available
    throw new InternalServerError('Profile completion calculation not available');
  }

  /**
   * Get onboarding status
   */
  static async getOnboardingStatus(uid: string): Promise<any> {
    const profile = await Profile.findOne({ uid }).lean();

    if (!profile) {
      return {
        isCompleted: false,
        completedSteps: {
          location: false,
          roles: false,
          profile: false
        },
        lastStep: 'location'
      };
    }

    return profile.onboardingStatus || {
      isCompleted: false,
      completedSteps: {
        location: false,
        roles: false,
        profile: false
      },
      lastStep: 'location'
    };
  }

  /**
   * List users for admin with filters
   */
  static async listUsersForAdmin(params: {
    page: number;
    limit: number;
    search?: string;
    status?: string;
    role?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }): Promise<{
    data: any[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      pages: number;
    };
  }> {
    this.checkConnection();

    const MAX_LIMIT = 50;
    const MAX_PAGE = 100;
    const { page, limit, search, status, role, sortBy = 'createdAt', sortOrder = 'desc' } = params;
    const effectiveLimit = Math.min(Math.max(1, Number(limit) || 20), MAX_LIMIT);
    const effectivePage = Math.min(Math.max(1, Number(page) || 1), MAX_PAGE);
    const skip = (effectivePage - 1) * effectiveLimit;

    // Build query using $and to properly combine conditions
    const query: any = {};
    const andConditions: any[] = [];

    // Search by name, email, or phone
    if (search) {
      andConditions.push({
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } },
          { phone: { $regex: search, $options: 'i' } },
        ],
      });
    }

    // Filter by status
    // Handle both new status field and legacy isActive field
    // If no status filter, show all users (don't filter by status)
    if (status && status !== 'all') {
      if (status === 'active') {
        // Active users: either status='active' OR (status doesn't exist AND isActive=true)
        andConditions.push({
          $or: [
            { status: 'active' },
            { status: { $exists: false }, isActive: true },
          ],
        });
      } else {
        // For suspended/banned/inactive, check status field directly
        andConditions.push({ status: status });
      }
    }

    // Filter by role
    if (role && role !== 'all') {
      if (role === 'tasker') {
        andConditions.push({ roles: 'tasker' });
      } else if (role === 'poster') {
        andConditions.push({ roles: 'poster' });
      }
    }

    // Combine all conditions
    if (andConditions.length > 0) {
      if (andConditions.length === 1) {
        Object.assign(query, andConditions[0]);
      } else {
        query.$and = andConditions;
      }
    }
    
    // If no conditions, query will be empty {} which means "get all profiles"

    // Build sort
    const sort: any = {};
    sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

    // Log query for debugging
    logger.info('ListUsersForAdmin - Query:', JSON.stringify(query, null, 2));
    logger.info('ListUsersForAdmin - Params:', { page: effectivePage, limit: effectiveLimit, skip, sortBy, sortOrder, search, status, role });

    // First check total profiles in database (for debugging)
    const totalProfilesInDb = await Profile.countDocuments({});
    logger.info(`Total profiles in database: ${totalProfilesInDb}`);

    // Execute query
    const [profiles, total] = await Promise.all([
      Profile.find(query)
        .select('uid name email phone roles userType status isActive isVerified isAadhaarVerified isPANVerified isBankVerified rating totalReviews totalTasks completedTasks postedTasks earnedAmount photoURL createdAt updatedAt bannedAt suspendedAt')
        .sort(sort)
        .skip(skip)
        .limit(effectiveLimit)
        .lean(),
      Profile.countDocuments(query),
    ]);

    // Log results for debugging
    logger.info(`ListUsersForAdmin - Results: ${profiles.length} profiles found, total matching query: ${total}, total in DB: ${totalProfilesInDb}`);
    
    if (profiles.length > 0) {
      logger.info('Sample profile:', {
        uid: profiles[0].uid,
        name: profiles[0].name,
        status: profiles[0].status,
        isActive: profiles[0].isActive,
      });
    } else if (totalProfilesInDb > 0) {
      logger.warn(`⚠️ Query returned 0 profiles but database has ${totalProfilesInDb} profiles. Query might be too restrictive.`);
    }

    // Transform to match expected format
    const data = profiles.map((profile: any) => {
      // Determine status: use status field if exists, otherwise derive from isActive
      const userStatus = profile.status || (profile.isActive !== false ? 'active' : 'inactive');
      
      return {
        userId: profile.uid,
        uid: profile.uid,
        name: profile.name || '',
        email: profile.email || '',
        phone: profile.phone || '',
        role: profile.roles?.includes('tasker')
          ? 'tasker'
          : profile.roles?.includes('poster')
            ? 'poster'
            : 'unknown',
        roles: profile.roles || [],
        userType: profile.userType || 'individual',
        status: userStatus,
        isVerified: profile.isVerified || false,
        isActive: profile.isActive !== false,
        rating: profile.rating || 0,
        totalReviews: profile.totalReviews || 0,
        totalTasks: profile.totalTasks || 0,
        completedTasks: profile.completedTasks || 0,
        postedTasks: profile.postedTasks || 0,
        earnedAmount: profile.earnedAmount || 0,
        photoURL: profile.photoURL || null,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
        // Include additional profile fields
        isAadhaarVerified: profile.isAadhaarVerified || false,
        isPANVerified: profile.isPANVerified || false,
        isBankVerified: profile.isBankVerified || false,
        bannedAt: profile.bannedAt || null,
        suspendedAt: profile.suspendedAt || null,
      };
    });

    return {
      data,
      pagination: {
        page: effectivePage,
        limit: effectiveLimit,
        total,
        pages: Math.ceil(total / effectiveLimit),
      },
    };
  }

  /**
   * Aggregate role counts directly from profiles collection.
   */
  static async getRoleCountsForAdmin(): Promise<{
    posters: number;
    taskers: number;
    totalProfiles: number;
  }> {
    this.checkConnection();

    const [posters, taskers, totalProfiles] = await Promise.all([
      Profile.countDocuments({ roles: 'poster' }),
      Profile.countDocuments({ roles: 'tasker' }),
      Profile.countDocuments({}),
    ]);

    return {
      posters,
      taskers,
      totalProfiles,
    };
  }

  /**
   * Get user for admin (full profile data)
   */
  static async getUserForAdmin(userId: string): Promise<any> {
    this.checkConnection();

    const profile = await Profile.findOne({ uid: userId }).lean();

    if (!profile) {
      throw new NotFoundError('User not found');
    }

    // Try to enrich with real-time stats from task/review services.
    let realTimeStats: {
      totalTasks?: number;
      completedTasks?: number;
      postedTasks?: number;
      totalReviews?: number;
      avgRating?: number;
    } = {};
    try {
      realTimeStats = await statsService.calculateAllStats(
        profile._id.toString(),
        profile.uid
      );
    } catch (error: any) {
      logger.warn('Failed to fetch real-time stats for getUserForAdmin', {
        userId,
        error: error.message,
      });
    }

    // Return full profile data with admin-friendly format
    // Spread profile first, then override with admin-specific fields
    const result: any = {
      ...profile,
    };
    
    // Add admin-friendly fields (these override the spread values)
    result.userId = profile.uid;
    result.role = profile.roles?.includes('tasker')
      ? 'tasker'
      : profile.roles?.includes('poster')
        ? 'poster'
        : 'unknown';
    result.status = profile.status || (profile.isActive ? 'active' : 'inactive');
    if (!result.email) result.email = '';
    if (!result.phone) result.phone = '';

    // Prefer real-time values when available.
    result.totalTasks = Number(realTimeStats.totalTasks ?? profile.totalTasks ?? 0);
    result.completedTasks = Number(realTimeStats.completedTasks ?? profile.completedTasks ?? 0);
    result.postedTasks = Number(realTimeStats.postedTasks ?? profile.postedTasks ?? 0);
    result.totalReviews = Number(realTimeStats.totalReviews ?? profile.totalReviews ?? 0);
    const liveRating = realTimeStats.avgRating;
    result.rating = Number(
      typeof liveRating === 'number' && liveRating > 0
        ? Math.round(liveRating * 10) / 10
        : profile.rating ?? 0
    );
    
    return result;
  }

  /**
   * Update user for admin
   */
  static async updateUserForAdmin(
    userId: string,
    updates: any,
    _adminUserId?: string
  ): Promise<any> {
    this.checkConnection();

    const profile = await Profile.findOne({ uid: userId });

    if (!profile) {
      throw new NotFoundError('User not found');
    }

    // Update allowed fields
    const allowedFields = [
      'name',
      'email',
      'phone',
      'roles',
      'userType',
      'isActive',
      'isVerified',
      'status',
    ];

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        (profile as any)[field] = updates[field];
      }
    }

    await profile.save();

    return this.getUserForAdmin(userId);
  }

  /**
   * Ban user
   */
  static async banUser(userId: string, reason: string, adminUserId?: string): Promise<any> {
    this.checkConnection();

    const profile = await Profile.findOne({ uid: userId });

    if (!profile) {
      throw new NotFoundError('User not found');
    }

    profile.status = 'banned';
    profile.isActive = false;
    profile.bannedAt = new Date();
    profile.banReason = reason;
    profile.bannedBy = adminUserId || undefined;

    await profile.save();

    logger.info(`User banned: ${userId} by admin: ${adminUserId || 'system'}`);

    return this.getUserForAdmin(userId);
  }

  /**
   * Unban user
   */
  static async unbanUser(userId: string, adminUserId?: string): Promise<any> {
    this.checkConnection();

    const profile = await Profile.findOne({ uid: userId });

    if (!profile) {
      throw new NotFoundError('User not found');
    }

    profile.status = 'active';
    profile.isActive = true;
    profile.bannedAt = null;
    profile.banReason = undefined;
    profile.bannedBy = undefined;

    await profile.save();

    logger.info(`User unbanned: ${userId} by admin: ${adminUserId || 'system'}`);

    return this.getUserForAdmin(userId);
  }

  /**
   * Suspend user
   */
  static async suspendUser(userId: string, reason: string, adminUserId?: string): Promise<any> {
    this.checkConnection();

    const profile = await Profile.findOne({ uid: userId });

    if (!profile) {
      throw new NotFoundError('User not found');
    }

    profile.status = 'suspended';
    profile.isActive = false;
    profile.suspendedAt = new Date();
    profile.suspendReason = reason;
    profile.suspendedBy = adminUserId || undefined;

    await profile.save();

    logger.info(`User suspended: ${userId} by admin: ${adminUserId || 'system'}`);

    return this.getUserForAdmin(userId);
  }

  /**
   * Unsuspend user
   */
  static async unsuspendUser(userId: string, adminUserId?: string): Promise<any> {
    this.checkConnection();

    const profile = await Profile.findOne({ uid: userId });

    if (!profile) {
      throw new NotFoundError('User not found');
    }

    profile.status = 'active';
    profile.isActive = true;
    profile.suspendedAt = null;
    profile.suspendReason = undefined;
    profile.suspendedBy = undefined;

    await profile.save();

    logger.info(`User unsuspended: ${userId} by admin: ${adminUserId || 'system'}`);

    return this.getUserForAdmin(userId);
  }

  /**
   * Update profile statistics from task-service
   * Called via internal service-to-service API
   */
  static async updateStatsFromTaskService(
    profileId: string,
    stats: {
      totalTasks?: number;
      completedTasks?: number;
      postedTasks?: number;
      totalReviews?: number;
      rating?: number;
    }
  ): Promise<void> {
    await Profile.findByIdAndUpdate(profileId, {
      $set: stats,
    });
    
    console.log(`✅ Updated profile ${profileId} with stats from task-service`);
  }

  /**
   * Update user's selected categories for alerts
   */
  static async updateCategoryAlerts(uid: string, categories: Array<{ slug: string; name: string }>): Promise<any> {
    this.checkConnection();

    const profile = await Profile.findOneAndUpdate(
      { uid },
      {
        $set: {
          'savedCategories.categories': categories,
          'savedCategories.updatedAt': new Date()
        }
      },
      { new: true }
    );

    if (!profile) {
      throw new Error(`Profile not found for UID: ${uid}`);
    }

    logger.info('ProfileService.updateCategoryAlerts: Categories updated', {
      uid,
      categoryCount: categories.length
    });

    return profile;
  }

  /**
   * Update user's selected keywords for alerts
   */
  static async updateKeywordAlerts(uid: string, keywords: string[]): Promise<any> {
    this.checkConnection();

    const profile = await Profile.findOneAndUpdate(
      { uid },
      {
        $set: {
          'savedKeywords.keywords': keywords,
          'savedKeywords.updatedAt': new Date()
        }
      },
      { new: true }
    );

    if (!profile) {
      throw new Error(`Profile not found for UID: ${uid}`);
    }

    logger.info('ProfileService.updateKeywordAlerts: Keywords updated', {
      uid,
      keywordCount: keywords.length
    });

    return profile;
  }
}
