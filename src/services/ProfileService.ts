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
      .select('uid name email phone roles userType skills rating totalReviews isVerified isAadhaarVerified aadhaarVerifiedAt location photoURL totalTasks completedTasks postedTasks earnedAmount business onboardingStatus savedAddresses')
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
        uid,
        value: profileData.aadhaarVerifiedAt,
        previousValue: existingProfile.aadhaarVerifiedAt
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
    const hasName = (profileData.name !== undefined && profileData.name) || existingProfile.name;
    const hasEmail = (profileData.email !== undefined && profileData.email) || existingProfile.email;

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
   * Delete profile and all associated data
   */
  static async deleteProfile(uid: string): Promise<{ deletedCount: number; cascadeDeleteResult?: any }> {
    const env = validateEnv();
    
    logger.info(`🗑️ Starting profile deletion for user: ${uid}`);

    try {
      // Step 1: Delete all associated data in Task Service (cascading delete)
      let cascadeDeleteResult = null;
      if (env.TASK_SERVICE_URL && env.SERVICE_AUTH_TOKEN) {
        try {
          logger.info(`📞 Calling Task Service to delete user data: ${uid}`);
          
          const taskServiceUrl = env.TASK_SERVICE_URL;
          const response = await axios.delete(
            `${taskServiceUrl}/api/v1/cascade-delete/user/${uid}`,
            {
              headers: {
                'X-Service-Auth': env.SERVICE_AUTH_TOKEN,
                'X-Service-Name': 'user-service',
                'X-User-Id': uid
              },
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
}

