import { Request } from "express";

// Extended Express Request with user
export interface AuthenticatedRequest extends Request {
   user?: {
      uid: string; // MongoDB user _id carried in JWT sub
      token?: string;
      sessionId?: string;
   };
   rateLimitUserId?: string;
   isServiceCall?: boolean; // Indicates if request came from another service
   serviceName?: string; // Name of the calling service
}

// Profile types
export interface Location {
   type: "Point";
   coordinates: [number, number]; // [longitude, latitude]
   address?: string | null;
   addressDetails?: {
      doorNo?: string | null;
      area?: string | null;
      city?: string | null;
      state?: string | null;
      pinCode?: string | null;
      country?: string | null;
   };
   isPublic?: boolean;
}

export interface HomeLocation extends Location {}

export interface SavedAddress {
   _id?: string;
   label: "Home" | "Work" | "Other";
   address: string;
   coordinates: [number, number]; // [longitude, latitude]
   city?: string;
   state?: string;
   country?: string;
   addressDetails?: {
      doorNo?: string;
      landmark?: string;
      area?: string;
      pinCode?: string;
   };
   name?: string;
   phone?: string;
   isDefault?: boolean;
   createdAt?: Date;
}

export interface OnboardingStatus {
   isCompleted: boolean;
   completedSteps: {
      roles: boolean;
      profile: boolean;
   };
   completedAt?: number | null;
   lastStep: "roles" | "profile";
}

export interface PortfolioItem {
   title: string;
   description?: string;
   url?: string;
   images?: string[];
   createdAt?: Date;
   updatedAt?: Date;
}

export interface BusinessProfile {
   description?: string;
   pan?: {
      number?: string;
      isPANVerified?: boolean;
      panVerifiedAt?: Date;
      panVerificationRef?: string;
   };
   bankAccount?: {
      accountNumber?: string;
      accountHolderName?: string;
      ifsc?: string;
      bankName?: string;
      isVerified?: boolean;
      verifiedAt?: Date;
      verificationRef?: string;
   };
   gstNumber?: string;
   isGSTVerified?: boolean;
   gstVerifiedAt?: Date;
   gstVerificationRef?: string;
   authorizedSignatory?: {
      name?: string;
      aadhaarNumber?: string;
      isAadhaarVerified?: boolean;
      aadhaarVerifiedAt?: Date;
   };
   documents?: Array<{
      type: string;
      url: string;
      uploadedAt: Date;
      verified: boolean;
   }>;
   verificationStatus?: {
      level: number;
      badge: "basic" | "verified" | "trusted" | "enterprise";
      verifiedAt?: Date;
      requirements?: {
         pan?: boolean;
         bank?: boolean;
         gst?: boolean;
         aadhaar?: boolean;
      };
   };
   updatedAt?: Date;
}

export type ProfileVisibilityLevel = 'public' | 'registered_users' | 'connections_only' | 'private';

export interface ProfilePrivacy {
   profileVisibility: ProfileVisibilityLevel;
   showEarnings: boolean;
   showTaskHistory: boolean;
   showReviews: boolean;
   locationSharing: boolean;
   analyticsTracking: boolean;
}

export interface DataPrivacy {
   deletionRequested?: boolean;
   deletionRequestedAt?: Date;
   deletionScheduledFor?: Date;
   accountDeleted?: boolean;
   accountDeletedAt?: Date;
   accountDeletionReason?: string;
   lastDataExport?: Date;
   dataRetentionExpiry?: Date;
}

// Service response types
export interface ServiceResponse<T = any> {
   success: boolean;
   data?: T;
   error?: string;
   message?: string;
}

// API Response types
export interface ApiResponse<T = any> {
   success: boolean;
   data?: T;
   error?: string;
   message?: string;
}

// Auth types
export interface SignupRequest {
   email?: string;
   password: string;
   displayName?: string;
   phoneNumber?: string;
}

export interface LoginRequest {
   email: string;
   password: string;
}

export interface LoginResponse {
   idToken: string;
   refreshToken: string;
   expiresIn: string;
   localId: string;
   email: string;
}

// IProfileDocument is exported from models/Profile.ts

export type PartnerProfileStatus = 'not_applied' | 'draft' | 'pending_review' | 'approved' | 'rejected' | 'suspended';

export interface PartnerProfile {
  status: PartnerProfileStatus;
  approvedAt?: Date;
  approvedBy?: string;
  onboardingCompleted?: boolean;
  languages?: string[];
  gender?: string;
  dob?: Date;
  categories?: string[];
  skills?: Record<string, string[]>;
  workAreas?: string[];
  experience?: Record<string, string>;
  vehicle?: { type?: string; number?: string };
  qualification?: string;
  professionalExperience?: string;
  careLanguages?: string;
  careAgeGroups?: string;
  workPlace?: Record<string, string>;
  workPhotos?: string[];
  dlFront?: string;
  dlBack?: string;
  rc?: string;
  experienceProofs?: Record<string, string[]>;
}

export type SupplyProgram = 'marketplace' | 'book_now';

export interface ILocation {
   type: "Point";
   coordinates: [number, number];
   address?: string | null;
   addressDetails?: {
      doorNo?: string | null;
      area?: string | null;
      city?: string | null;
      state?: string | null;
      pinCode?: string | null;
      country?: string | null;
   };
   isPublic?: boolean;
}
