import { Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { ProfileService } from '../services/ProfileService';
import { IProfile } from '../models/Profile';

export class ProfileController {
  /**
   * GET /api/v1/profiles/me
   */
  static async getMyProfile(req: AuthenticatedRequest, res: Response): Promise<void> {
    const uid = req.user!.uid;
    const profile = await ProfileService.getMyProfile(uid);
    
    res.json({
      id: profile.uid,
      ...profile,
      isAadhaarVerified: profile.isAadhaarVerified || false,
      aadhaarVerifiedAt: profile.aadhaarVerifiedAt || null
    });
  }

  /**
   * GET /api/v1/profiles/search
   */
  static async searchProfiles(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { q, limit = 10 } = req.query;
    const currentUserId = req.user?.uid;
    
    const profiles = await ProfileService.searchProfiles(
      q as string,
      parseInt(limit as string),
      currentUserId
    );
    
    res.json({
      success: true,
      users: profiles.map(profile => ({
        uid: profile.uid,
        name: profile.name,
        email: profile.email,
        phone: profile.phone,
        roles: profile.roles,
        userType: profile.userType,
        skills: profile.skills,
        rating: profile.rating,
        totalReviews: profile.totalReviews,
        isVerified: profile.isVerified,
        isAadhaarVerified: profile.isAadhaarVerified,
        location: profile.location
      }))
    });
  }

  /**
   * GET /api/v1/profiles/public/:uid
   */
  static async getPublicProfile(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { uid } = req.params;
    const profile = await ProfileService.getProfileByUid(uid);
    
    const publicProfile = {
      uid: profile.uid,
      name: profile.name,
      roles: profile.roles,
      userType: profile.userType,
      rating: profile.rating,
      totalReviews: profile.totalReviews,
      skills: profile.skills,
      photoURL: profile.photoURL || null,
      location: profile.location ? {
        city: profile.location.addressDetails?.city,
        state: profile.location.addressDetails?.state,
        country: profile.location.addressDetails?.country
      } : null,
      isVerified: profile.isVerified,
      isAadhaarVerified: profile.isAadhaarVerified || false,
      aadhaarVerifiedAt: profile.aadhaarVerifiedAt || null,
      isActive: profile.isActive,
      createdAt: profile.createdAt
    };
    
    res.json({
      success: true,
      profile: publicProfile
    });
  }

  /**
   * GET /api/v1/profiles/:uid
   */
  static async getProfile(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { uid } = req.params;
    const profile = await ProfileService.getProfileByUid(uid);
    
    const publicProfile = {
      uid: profile.uid,
      name: profile.name,
      roles: profile.roles,
      userType: profile.userType,
      rating: profile.rating,
      totalReviews: profile.totalReviews,
      skills: profile.skills,
      photoURL: profile.photoURL || null,
      location: profile.location ? {
        city: profile.location.addressDetails?.city,
        state: profile.location.addressDetails?.state,
        country: profile.location.addressDetails?.country
      } : null,
      isVerified: profile.isVerified,
      isAadhaarVerified: profile.isAadhaarVerified || false,
      aadhaarVerifiedAt: profile.aadhaarVerifiedAt || null,
      isActive: profile.isActive,
      createdAt: profile.createdAt
    };
    
    res.json({
      success: true,
      profile: publicProfile
    });
  }

  /**
   * POST /api/v1/profiles
   */
  static async createProfile(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user || !req.user.uid) {
      res.status(401).json({
        error: 'Authentication required',
        message: 'Please log in to continue'
      });
      return;
    }
    
    const uid = req.user.uid;
    const profileData: Partial<IProfile> = req.body;
    
    const savedProfile = await ProfileService.upsertProfile(uid, profileData);
    
    res.json({
      id: uid,
      ...savedProfile,
      message: 'Profile created successfully'
    });
  }

  /**
   * PUT /api/v1/profiles/me
   */
  static async updateProfile(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!req.user || !req.user.uid) {
      res.status(401).json({
        error: 'Authentication required',
        message: 'Please log in to continue'
      });
      return;
    }
    
    const uid = req.user.uid;
    const profileData: Partial<IProfile> = req.body;
    
    const updatedProfile = await ProfileService.updateProfile(uid, profileData);
    
    res.json({
      success: true,
      id: uid,
      ...updatedProfile,
      message: 'Profile updated successfully'
    });
  }

  /**
   * DELETE /api/v1/profiles/me
   */
  static async deleteProfile(req: AuthenticatedRequest, res: Response): Promise<void> {
    const uid = req.user!.uid;
    const deleteResult = await ProfileService.deleteProfile(uid);
    
    // Old format: return success, message, and deletedCount
    res.json({
      success: true,
      message: 'Profile deleted successfully',
      deletedCount: deleteResult.deletedCount
    });
  }

  /**
   * GET /api/v1/profiles/completion
   */
  static async getProfileCompletion(req: AuthenticatedRequest, res: Response): Promise<void> {
    const uid = req.user!.uid;
    const completion = await ProfileService.getProfileCompletion(uid);
    
    res.json({
      success: true,
      ...completion
    });
  }

  /**
   * GET /api/v1/profiles/onboarding-status
   */
  static async getOnboardingStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
    const uid = req.user!.uid;
    const status = await ProfileService.getOnboardingStatus(uid);
    
    res.json(status);
  }
}

