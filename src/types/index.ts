import { Request } from 'express';
import { DecodedIdToken } from 'firebase-admin/auth';

// Extended Express Request with user
export interface AuthenticatedRequest extends Request {
  user?: {
    uid: string;
    token: DecodedIdToken | string; // Can be DecodedIdToken or raw JWT string for service calls
  };
  rateLimitUserId?: string;
  isServiceCall?: boolean; // Indicates if request came from another service
  serviceName?: string; // Name of the calling service
}

// Profile types
export interface Location {
  type: 'Point';
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

export interface OnboardingStatus {
  isCompleted: boolean;
  completedSteps: {
    roles: boolean;
    profile: boolean;
  };
  completedAt?: number | null;
  lastStep: 'roles' | 'profile';
}

export interface BusinessProfile {
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
    badge: 'basic' | 'verified' | 'trusted' | 'enterprise';
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

export interface DataPrivacy {
  deletionRequested?: boolean;
  deletionRequestedAt?: Date;
  deletionScheduledFor?: Date;
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

export interface ILocation {
  type: 'Point';
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
