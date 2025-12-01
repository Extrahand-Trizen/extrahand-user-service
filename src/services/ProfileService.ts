import Profile, { IProfile, IProfileDocument } from '../models/Profile';
import { ILocation } from '../types';
import { NotFoundError, BadRequestError, InternalServerError } from '../errors/AppError';
import logger from '../config/logger';
import mongoose from 'mongoose';
import { getConnectionStatus } from '../config/database';

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
      .select('uid name email phone roles userType skills rating totalReviews isVerified isAadhaarVerified aadhaarVerifiedAt location photoURL totalTasks completedTasks postedTasks earnedAmount business onboardingStatus')
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
   * Create or update profile
   */
  static async upsertProfile(uid: string, profileData: Partial<IProfile>): Promise<IProfileDocument> {
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
    if (!existingProfile) {
      payload.createdAt = now;
    }

    // Update onboarding status
    const hasLocation = !!processedLocation;
    const hasRoles = Array.isArray(profileData.roles) && profileData.roles.length > 0;
    const hasName = !!profileData.name;
    const hasEmail = !!profileData.email;

    const currentOnboardingStatus = existingProfile?.onboardingStatus || {
      isCompleted: false,
      completedSteps: { location: false, roles: false, profile: false },
      lastStep: 'location'
    };

    const updatedCompletedSteps = {
      location: hasLocation || currentOnboardingStatus.completedSteps.location,
      roles: hasRoles || currentOnboardingStatus.completedSteps.roles,
      profile: (hasName && hasEmail) || currentOnboardingStatus.completedSteps.profile
    };

    const isOnboardingComplete = updatedCompletedSteps.location && updatedCompletedSteps.roles;

    let lastStep = currentOnboardingStatus.lastStep;
    if (hasLocation) lastStep = 'location';
    if (hasRoles) lastStep = 'roles';
    if (hasName && hasEmail) lastStep = 'profile';

    payload.onboardingStatus = {
      isCompleted: isOnboardingComplete,
      completedSteps: updatedCompletedSteps,
      completedAt: isOnboardingComplete ? now : null,
      lastStep
    };

    await Profile.updateOne({ uid }, { $set: payload }, { upsert: true });

    const savedProfile = await Profile.findOne({ uid }).lean();
    if (!savedProfile) {
      throw new Error('Profile was saved but could not be retrieved');
    }

    return savedProfile as unknown as IProfileDocument;
  }

  /**
   * Update profile
   */
  static async updateProfile(uid: string, profileData: Partial<IProfile>): Promise<IProfileDocument> {
    const existingProfile = await Profile.findOne({ uid }).lean();
    if (!existingProfile) {
      throw new NotFoundError('Profile not found. Please create a profile first.');
    }

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
    if (profileData.business !== undefined) updatePayload.business = profileData.business;
    if (profileData.agreeUpdates !== undefined) updatePayload.agreeUpdates = profileData.agreeUpdates;
    if (profileData.agreeTerms !== undefined) updatePayload.agreeTerms = profileData.agreeTerms;

    // Update onboarding status
    const hasLocation = updatePayload.location || existingProfile.location;
    const hasRoles = (profileData.roles && Array.isArray(profileData.roles) && profileData.roles.length > 0) || existingProfile.roles;
    const hasName = (profileData.name !== undefined && profileData.name) || existingProfile.name;
    const hasEmail = (profileData.email !== undefined && profileData.email) || existingProfile.email;

    const currentOnboardingStatus = existingProfile.onboardingStatus || {
      isCompleted: false,
      completedSteps: { location: false, roles: false, profile: false },
      lastStep: 'location'
    };

    const updatedCompletedSteps = {
      location: !!hasLocation || currentOnboardingStatus.completedSteps.location,
      roles: !!hasRoles || currentOnboardingStatus.completedSteps.roles,
      profile: (hasName && hasEmail) || currentOnboardingStatus.completedSteps.profile
    };

    const isOnboardingComplete = updatedCompletedSteps.location && updatedCompletedSteps.roles;

    let lastStep = currentOnboardingStatus.lastStep;
    if (updatePayload.location) lastStep = 'location';
    if (profileData.roles && Array.isArray(profileData.roles) && profileData.roles.length > 0) lastStep = 'roles';
    if (profileData.name && profileData.email) lastStep = 'profile';

    updatePayload.onboardingStatus = {
      isCompleted: isOnboardingComplete,
      completedSteps: updatedCompletedSteps,
      completedAt: isOnboardingComplete ? (currentOnboardingStatus.completedAt || now) : null,
      lastStep
    };

    await Profile.updateOne({ uid }, { $set: updatePayload });

    const updatedProfile = await Profile.findOne({ uid }).lean();
    if (!updatedProfile) {
      throw new Error('Profile was updated but could not be retrieved');
    }

    return updatedProfile as unknown as IProfileDocument;
  }

  /**
   * Delete profile
   */
  static async deleteProfile(uid: string): Promise<{ deletedCount: number }> {
    const deleteResult = await Profile.deleteOne({ uid });

    if (deleteResult.deletedCount === 0) {
      throw new NotFoundError('Profile not found');
    }

    return { deletedCount: deleteResult.deletedCount };
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
}

