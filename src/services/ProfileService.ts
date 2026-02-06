import Profile, { IProfile, IProfileDocument } from '../models/Profile';
import { ILocation } from '../types';
import { NotFoundError, BadRequestError, InternalServerError } from '../errors/AppError';
import logger from '../config/logger';
import mongoose from 'mongoose';
import { getConnectionStatus } from '../config/database';
import axios from 'axios';
import { validateEnv } from '../config/env';
import { auth } from '../config/firebase';

export class ProfileService {
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
      .select('uid name email phone roles userType skills rating totalReviews isVerified isAadhaarVerified aadhaarVerifiedAt maskedAadhaar isEmailVerified emailVerifiedAt isBankVerified bankVerifiedAt maskedBankAccount bankAccount maskedPan location photoURL totalTasks completedTasks postedTasks earnedAmount business onboardingStatus savedAddresses createdAt updatedAt')
      .lean();

    if (!profile) {
      throw new NotFoundError('Profile not found. Please complete the onboarding process.');
    }

    return profile as unknown as IProfileDocument;
  }

  /**
   * Get profile by UID (public profile)
   */
  static async getProfileByUid(uid: string): Promise<IProfileDocument> {
    const profile = await Profile.findOne({ uid, isActive: true }).lean();

    if (!profile) {
      throw new NotFoundError('Profile not found');
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
        .select('_id uid name email phone roles userType skills rating totalReviews isVerified isAadhaarVerified aadhaarVerifiedAt isBankVerified bankVerifiedAt photoURL location totalTasks completedTasks postedTasks earnedAmount business createdAt isActive')
        .lean();

      if (!profile) {
        throw new NotFoundError('Profile not found');
      }

      if (!profile.isActive) {
        throw new NotFoundError('Profile not found');
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
    name: string;
    photoURL?: string | null;
    rating?: number;
    totalReviews?: number;
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
        .select('_id name photoURL rating totalReviews')
        .lean();

      profiles.forEach(profile => {
        profileMap.set(profile._id.toString(), {
          _id: profile._id,
          name: profile.name || 'Anonymous',
          photoURL: profile.photoURL || null,
          rating: profile.rating || 0,
          totalReviews: profile.totalReviews || 0,
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
      .select('uid name email phone roles userType skills rating totalReviews isVerified isAadhaarVerified aadhaarVerifiedAt location')
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
      const users = await Profile.find({
        roles: { $in: ['tasker', 'both'] },
        isActive: true,
        isVerified: true,  // Only verified taskers
        'skills.primaryCategory': category
      })
        .select('uid')
        .lean();

      const userIds = users.map((u: any) => u.uid);
      logger.info('ProfileService: Found users by skill category', {
        category,
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
      // Escape special regex characters and create case-insensitive patterns
      const keywordPatterns = keywords.map(k => 
        k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      );

      const users = await Profile.find({
        isActive: true,
        isVerified: true,
        'savedKeywords.keywords': {
          $in: keywordPatterns
        }
      })
        .select('uid')
        .lean();

      const userIds = users.map((u: any) => u.uid);
      logger.info('ProfileService: Found users by keywords', {
        keywordCount: keywords.length,
        userCount: userIds.length
      });

      return userIds;
    } catch (error) {
      logger.error('ProfileService.findUsersByAnyKeyword error:', {
        keywordCount: keywords.length,
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

    if (profileData.name) payload.name = profileData.name;
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
    if (profileData.business !== undefined) payload.business = profileData.business;
    if (profileData.agreeUpdates !== undefined) payload.agreeUpdates = profileData.agreeUpdates;
    if (profileData.agreeTerms !== undefined) payload.agreeTerms = profileData.agreeTerms;

    // Check if profile exists
    const existingProfile = await Profile.findOne({ uid }).lean();
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
      updateData: {
        isAadhaarVerified: profileData.isAadhaarVerified,
        aadhaarVerifiedAt: profileData.aadhaarVerifiedAt
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
    if (profileData.email !== undefined) updatePayload.email = profileData.email;
    if (profileData.phone !== undefined) updatePayload.phone = profileData.phone;
    if (profileData.photoURL !== undefined) updatePayload.photoURL = profileData.photoURL;
    if (profileData.roles !== undefined) updatePayload.roles = profileData.roles;
    if (profileData.userType !== undefined) updatePayload.userType = profileData.userType;
    
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
    if (profileData.business !== undefined) updatePayload.business = profileData.business;
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

    const { page, limit, search, status, role, sortBy = 'createdAt', sortOrder = 'desc' } = params;
    const skip = (page - 1) * limit;

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
        andConditions.push({ roles: { $in: ['tasker', 'both'] } });
      } else if (role === 'poster' || role === 'requester') {
        andConditions.push({ roles: { $in: ['requester', 'both'] } });
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
    logger.info('ListUsersForAdmin - Params:', { page, limit, skip, sortBy, sortOrder, search, status, role });

    // First check total profiles in database (for debugging)
    const totalProfilesInDb = await Profile.countDocuments({});
    logger.info(`Total profiles in database: ${totalProfilesInDb}`);

    // Execute query
    const [profiles, total] = await Promise.all([
      Profile.find(query)
        .select('uid name email phone roles userType status isActive isVerified isAadhaarVerified isPANVerified isBankVerified rating totalReviews totalTasks completedTasks postedTasks earnedAmount photoURL createdAt updatedAt bannedAt suspendedAt')
        .sort(sort)
        .skip(skip)
        .limit(limit)
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
        role: profile.roles?.includes('both') ? 'both' : profile.roles?.[0] || 'tasker',
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
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
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

    // Return full profile data with admin-friendly format
    // Spread profile first, then override with admin-specific fields
    const result: any = {
      ...profile,
    };
    
    // Add admin-friendly fields (these override the spread values)
    result.userId = profile.uid;
    result.role = profile.roles?.includes('both') ? 'both' : profile.roles?.[0] || 'tasker';
    result.status = profile.status || (profile.isActive ? 'active' : 'inactive');
    if (!result.email) result.email = '';
    if (!result.phone) result.phone = '';
    
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

}
