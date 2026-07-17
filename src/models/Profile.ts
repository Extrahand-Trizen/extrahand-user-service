import mongoose, { Schema, Model, Document } from 'mongoose';
import { Location, OnboardingStatus, BusinessProfile, DataPrivacy, ProfilePrivacy, SavedAddress, PortfolioItem, PartnerProfile, SupplyProgram } from '../types';
import { ALL_PRIMARY_CATEGORIES } from '../constants/categories';

export interface IProfile extends Document {
  uid: string;
  name: string;
  profession?: string;
  email?: string | null;
  isEmailVerified?: boolean;
  emailVerifiedAt?: Date | null;
  phone?: string | null;
  alternatePhone?: string | null;
  alternatePhoneVerified?: boolean;
  alternatePhoneVerifiedAt?: Date | null;
  client_type?: 'web' | 'mobile';
  roles: ('tasker' | 'poster' | 'partner')[];
  userType: 'individual' | 'business';
  bio?: string;
  portfolio?: PortfolioItem[];
  location?: Location | null;
  homeLocation?: Location | null;
  savedAddresses?: SavedAddress[];
  skills?: {
    primaryCategory?: string;
    list?: Array<{
      name: string;
      category?: string;
      yearsOfExperience?: number;
      certified?: boolean;
      certificates?: Array<{
        title: string;
        issuedBy: string;
        issuedDate: Date;
        documentUrl: string;
        verificationType?: 'certified' | 'licensed';
        certificateType?: string;
        issuingAuthority?: string;
        certificateNumber?: string;
        issueDate?: Date;
        expiryDate?: Date;
        status?: 'pending' | 'verified' | 'rejected';
        /** Display name (or email fallback) of the admin/onboarder who reviewed */
        reviewedBy?: string;
        /** Stable admin id (e.g. ADM-... or legacy Firebase uid) for analytics */
        reviewedByUserId?: string;
        reviewedAt?: Date;
        rejectionReason?: string;
        reviewNotes?: string;
      }>;
      verified?: boolean;
    }>;
    updatedAt?: Date;
  };
  rating: number;
  totalReviews: number;
  totalTasks: number;
  completedTasks: number;
  postedTasks?: number;
  earnedAmount?: number;
  isVerified: boolean;
  isAadhaarVerified: boolean;
  aadhaarVerifiedAt?: Date | null;
  maskedAadhaar?: string;
  isPANVerified: boolean;
  panVerifiedAt?: Date | null;
  maskedPan?: string;
  isBankVerified: boolean;
  bankVerifiedAt?: Date | null;
  maskedBankAccount?: string;
  bankAccount?: {
    accountHolderName?: string;
    bankName?: string;
    ifsc?: string;
  };
  isFaceVerified?: boolean;
  isActive: boolean;
  photoURL?: string | null;
  isAdminVerified?: boolean;
  phoneVerified?: boolean;
  adminCreatedAt?: Date;
  // Admin status management
  status?: 'active' | 'suspended' | 'banned' | 'inactive';
  bannedAt?: Date | null;
  suspendedAt?: Date | null;
  banReason?: string;
  suspendReason?: string;
  bannedBy?: string; // Admin user ID who banned
  suspendedBy?: string; // Admin user ID who suspended
  onboardingStatus?: OnboardingStatus;
  business?: BusinessProfile;
  agreeUpdates?: boolean;
  agreeTerms?: boolean;
  myOperatorContactId?: string | null;
  myOperatorContactCreatedAt?: Date | null;
  profilePrivacy?: ProfilePrivacy;
  dataPrivacy?: DataPrivacy;
  savedKeywords?: {
    keywords?: string[];
    updatedAt?: Date;
  };
  savedCategories?: {
    categories?: Array<{
      slug: string;
      name: string;
    }>;
    updatedAt?: Date;
  };
  bookNowCart?: {
    items?: Array<{
      catalogId: string;
      packageId: string;
      name: string;
      price: number;
      postTitleTemplate: string;
      taskDescription: string;
      quantity: number;
    }>;
    updatedAt?: Date;
  };
  referralCode?: string;
  gender?: string;
  dob?: Date;
  partnerProfile?: PartnerProfile;
  supplyPrograms?: SupplyProgram[];
  /** Top-level work areas for helper registration (NOT inside partnerProfile). */
  helperWorkAreas?: string[];
  verificationTier?: number;
  verificationBadge?: 'none' | 'basic' | 'verified' | 'trusted';
  lastVerifiedAt?: Date;
  roleVerifications?: {
    tasker?: {
      canAcceptTasks?: boolean;
      verifiedAt?: Date;
      requirements?: {
        aadhaar?: boolean;
        pan?: boolean;
        bank?: boolean;
        skills?: boolean;
        emergency?: boolean;
      };
    };
    poster?: {
      canPostTasks?: boolean;
      verifiedAt?: Date;
      requirements?: {
        aadhaar?: boolean;
        paymentMethod?: boolean;
        businessPAN?: boolean;
        businessBank?: boolean;
      };
    };
  };
  registrationStatus?: {
    currentStep: 'MOBILE_NUMBER' | 'OTP_VERIFY' | 'PERSONAL_DETAILS' | 'LOCATION' | 'WORK_AREAS' | 'CATEGORIES' | 'SKILLS' | 'EXPERIENCE' | 'REVIEW_PROFILE' | 'PARTNER_SUPPLY_ONBOARDING' | 'COMPLETED';
    completedSteps: string[];
    categoryIndex?: number;
  };
  createdAt?: Date;
  updatedAt?: Date;
  lastActive?: Date;
  
  // Static methods
  calculateCompletionPercentage(profile: IProfileDocument): {
    percentage: number;
    completedFields: string[];
    missingFields: string[];
  };
}

const ProfileSchema = new Schema<IProfile>({
  uid: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  name: {
    type: String,
    required: false,
    trim: true
  },
  profession: {
    type: String,
    trim: true,
    maxlength: 100,
  },
  email: {
    type: String,
    trim: true,
    lowercase: true
  },
  isEmailVerified: {
    type: Boolean,
    default: false
  },
  emailVerifiedAt: {
    type: Date
  },
  phone: {
    type: String,
    trim: true,
    unique: true,
    sparse: true, // Allows null/undefined values but enforces uniqueness for non-null values
    index: true
  },
  alternatePhone: {
    type: String,
    trim: true,
    unique: true,
    sparse: true,
    index: true,
  },
  alternatePhoneVerified: {
    type: Boolean,
    default: false,
  },
  alternatePhoneVerifiedAt: {
    type: Date,
    default: null,
  },
  client_type: {
    type: String,
    enum: ['web', 'mobile'],
    default: 'web',
    index: true,
  },
  roles: {
    type: [String],
    enum: ['tasker', 'poster', 'partner'],
    default: []
  },
  userType: {
    type: String,
    enum: ['individual', 'business'],
    default: 'individual'
  },
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number],
      required: false
    },
    address: String,
    addressDetails: {
      doorNo: String,
      area: String,
      city: String,
      state: String,
      pinCode: String,
      country: String
    },
    isPublic: Boolean
  },
  homeLocation: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number],
      required: false
    },
    address: String,
    addressDetails: {
      doorNo: String,
      area: String,
      city: String,
      state: String,
      pinCode: String,
      country: String
    },
    isPublic: Boolean
  },
  savedAddresses: [{
    _id: {
      type: Schema.Types.ObjectId,
      default: () => new mongoose.Types.ObjectId()
    },
    label: {
      type: String,
      enum: ['Home', 'Work', 'Other'],
      required: true
    },
    address: {
      type: String,
      required: true
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      required: true
    },
    city: String,
    state: String,
    country: {
      type: String,
      default: 'India'
    },
    addressDetails: {
      doorNo: String,
      landmark: String,
      area: String,
      pinCode: String
    },
    name: String,
    phone: String,
    isDefault: {
      type: Boolean,
      default: false
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  skills: {
    primaryCategory: {
      type: String,
      enum: ALL_PRIMARY_CATEGORIES
    },
    list: [{
      name: { type: String, required: true },
      category: String,
      yearsOfExperience: Number,
      certified: { type: Boolean, default: false },
      certificates: [{
        title: String,
        issuedBy: String,
        issuedDate: Date,
        uploadedAt: Date,
        documentUrl: String,
        verificationType: {
          type: String,
          enum: ['certified', 'licensed']
        },
        certificateType: String,
        issuingAuthority: String,
        certificateNumber: String,
        issueDate: Date,
        expiryDate: Date,
        status: {
          type: String,
          enum: ['pending', 'verified', 'rejected'],
          default: 'pending'
        },
        reviewedBy: String,
        reviewedByUserId: String,
        reviewedAt: Date,
        rejectionReason: String,
        reviewNotes: String
      }],
      verified: { type: Boolean, default: false }
    }],
    updatedAt: Date
  },
  rating: {
    type: Number,
    min: 0,
    max: 5
  },
  totalReviews: {
    type: Number
  },
  totalTasks: {
    type: Number
  },
  completedTasks: {
    type: Number
  },
  postedTasks: {
    type: Number
  },
  earnedAmount: {
    type: Number
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  isAadhaarVerified: {
    type: Boolean,
    default: false
  },
  aadhaarVerifiedAt: {
    type: Date
  },
  maskedAadhaar: {
    type: String
  },
  isPANVerified: {
    type: Boolean,
    default: false
  },
  panVerifiedAt: {
    type: Date
  },
  maskedPan: {
    type: String
  },
  isBankVerified: {
    type: Boolean,
    default: false
  },
  bankVerifiedAt: {
    type: Date
  },
  maskedBankAccount: {
    type: String
  },
  bankAccount: {
    accountHolderName: String,
    bankName: String,
    ifsc: String
  },
  isFaceVerified: {
    type: Boolean,
    default: false
  },
  isActive: {
    type: Boolean,
    default: true
  },
  photoURL: {
    type: String,
    default: null
  },
  bio: {
    type: String,
    trim: true,
    maxlength: 500,
    default: null
  },
  portfolio: [{
    title: { type: String, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 1000 },
    url: { type: String, trim: true, maxlength: 500 },
    images: [{ type: String, trim: true }],
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  }],
  isAdminVerified: {
    type: Boolean,
    default: false,
    index: true
  },
  phoneVerified: {
    type: Boolean,
    default: false,
    index: true
  },
  adminCreatedAt: Date,
  // Admin status management
  status: {
    type: String,
    enum: ['active', 'suspended', 'banned', 'inactive'],
    default: 'active',
    index: true
  },
  bannedAt: {
    type: Date,
    default: null
  },
  suspendedAt: {
    type: Date,
    default: null
  },
  banReason: {
    type: String,
    default: null
  },
  suspendReason: {
    type: String,
    default: null
  },
  bannedBy: {
    type: String,
    default: null
  },
  suspendedBy: {
    type: String,
    default: null
  },
  onboardingStatus: {
    isCompleted: {
      type: Boolean,
      default: false
    },
    completedSteps: {
      location: { type: Boolean, default: false },
      roles: { type: Boolean, default: false },
      profile: { type: Boolean, default: false }
    },
    completedAt: Date,
    lastStep: {
      type: String,
      enum: ['location', 'roles', 'profile'],
      default: 'location'
    }
  },
  registrationStatus: {
    currentStep: {
      type: String,
      enum: ['MOBILE_NUMBER', 'OTP_VERIFY', 'PERSONAL_DETAILS', 'LOCATION', 'WORK_AREAS', 'CATEGORIES', 'SKILLS', 'EXPERIENCE', 'REVIEW_PROFILE', 'PARTNER_SUPPLY_ONBOARDING', 'COMPLETED'],
      default: 'MOBILE_NUMBER'
    },
    completedSteps: {
      type: [String],
      default: []
    },
    categoryIndex: {
      type: Number,
      default: 0
    }
  },
  business: {
    name: String,
    type: {
      type: String,
      enum: ['Private Limited', 'LLP', 'Partnership', 'Sole Proprietorship', 'Other']
    },
    category: String,
    description: String,
    contactPerson: String,
    contactPersonDesignation: String,
    businessEmail: { type: String, lowercase: true, trim: true },
    businessPhone: String,
    registeredAddress: {
      street: String,
      city: String,
      state: String,
      pincode: String,
      country: { type: String, default: 'India' }
    },
    pan: {
      // ❌ SECURITY: DO NOT STORE RAW PAN NUMBER
      // number: String,
      maskedPAN: String,
      isPANVerified: { type: Boolean, default: false },
      panVerifiedAt: Date,
      panVerificationRef: String
    },
    bankAccount: {
      accountNumber: String,
      accountHolderName: String,
      ifsc: String,
      bankName: String,
      isVerified: { type: Boolean, default: false },
      verifiedAt: Date,
      verificationRef: String
    },
    gstNumber: String,
    isGSTVerified: { type: Boolean, default: false },
    gstVerifiedAt: Date,
    gstVerificationRef: String,
    authorizedSignatory: {
      name: String,
      aadhaarNumber: String,
      isAadhaarVerified: { type: Boolean, default: false },
      aadhaarVerifiedAt: Date
    },
    documents: [{
      type: {
        type: String,
        enum: ['registration', 'pan', 'gst', 'bank_statement', 'trade_license', 'other']
      },
      url: String,
      uploadedAt: Date,
      verified: { type: Boolean, default: false }
    }],
    verificationStatus: {
      level: { type: Number, enum: [0, 1, 2, 3], default: 0 },
      badge: {
        type: String,
        enum: ['basic', 'verified', 'trusted', 'enterprise'],
        default: 'basic'
      },
      verifiedAt: Date,
      requirements: {
        pan: { type: Boolean, default: false },
        bank: { type: Boolean, default: false },
        gst: { type: Boolean, default: false },
        aadhaar: { type: Boolean, default: false }
      }
    },
    updatedAt: Date
  },
  agreeUpdates: {
    type: Boolean,
    default: false
  },
  agreeTerms: {
    type: Boolean,
    default: false
  },
  // MyOperator contact tracking (publicapi.myoperator.co)
  myOperatorContactId: {
    type: String,
    default: null,
  },
  myOperatorContactCreatedAt: {
    type: Date,
    default: null,
  },
  profilePrivacy: {
    profileVisibility: {
      type: String,
      enum: ['public', 'registered_users', 'connections_only', 'private'],
      default: 'registered_users'
    },
    showEarnings: {
      type: Boolean,
      default: false
    },
    showTaskHistory: {
      type: Boolean,
      default: true
    },
    showReviews: {
      type: Boolean,
      default: true
    },
    locationSharing: {
      type: Boolean,
      default: true
    },
    analyticsTracking: {
      type: Boolean,
      default: true
    }
  },
  dataPrivacy: {
    deletionRequested: { type: Boolean, default: false },
    deletionRequestedAt: Date,
    deletionScheduledFor: Date,
    accountDeleted: { type: Boolean, default: false },
    accountDeletedAt: Date,
    accountDeletionReason: String,
    lastDataExport: Date,
    dataRetentionExpiry: Date
  },
  verificationTier: {
    type: Number,
    default: 0,
    min: 0,
    max: 3
  },
  verificationBadge: {
    type: String,
    enum: ['none', 'basic', 'verified', 'trusted'],
    default: 'none'
  },
  lastVerifiedAt: Date,
  roleVerifications: {
    tasker: {
      canAcceptTasks: { type: Boolean, default: false },
      verifiedAt: Date,
      requirements: {
        aadhaar: Boolean,
        pan: Boolean,
        bank: Boolean,
        skills: Boolean,
        emergency: Boolean
      }
    },
    poster: {
      canPostTasks: { type: Boolean, default: false },
      verifiedAt: Date,
      requirements: {
        aadhaar: Boolean,
        paymentMethod: Boolean,
        businessPAN: Boolean,
        businessBank: Boolean
      }
    }
  },
  lastActive: {
    type: Date,
    default: Date.now
  },
  savedKeywords: {
    keywords: {
      type: [String],
      default: [],
      index: true
    },
    updatedAt: Date
  },
  savedCategories: {
    categories: [{
      slug: String,
      name: String
    }],
    updatedAt: Date
  },
  bookNowCart: {
    items: [{
      catalogId: { type: String, required: true, trim: true },
      packageId: { type: String, required: true, trim: true },
      name: { type: String, required: true, trim: true },
      price: { type: Number, required: true, min: 0 },
      postTitleTemplate: { type: String, required: true, trim: true },
      taskDescription: { type: String, required: true, trim: true },
      quantity: { type: Number, required: true, min: 1, default: 1 },
    }],
    updatedAt: Date
  },
  referralCode: {
    type: String,
    trim: true,
    default: null,
  },
  gender: {
    type: String,
    trim: true,
  },
  dob: {
    type: Date,
  },
  partnerProfile: {
    status: {
      type: String,
      enum: ['not_applied', 'draft', 'pending_review', 'approved', 'rejected', 'suspended'],
      default: 'not_applied',
      index: true,
    },
    approvedAt: Date,
    approvedBy: String,
    onboardingCompleted: { type: Boolean, default: false },
    languages: { type: [String], default: [] },
    gender: String,
    dob: Date,
    categories: { type: [String], default: [] },
    skills: { type: Schema.Types.Mixed, default: {} },
    workAreas: { type: [String], default: [] },
    experience: { type: Schema.Types.Mixed, default: {} },
    vehicle: {
      type: { type: String },
      number: String,
    },
    qualification: String,
    professionalExperience: String,
    careLanguages: String,
    careAgeGroups: String,
    workPlace: { type: Schema.Types.Mixed, default: {} },
    workPhotos: { type: [String], default: [] },
    dlNumber: String,
    dlFront: String,
    dlBack: String,
    rc: String,
    experienceProofs: { type: Schema.Types.Mixed, default: {} },
  },
  supplyPrograms: {
    type: [{ type: String, enum: ['marketplace', 'book_now'] }],
    default: undefined,
  },
  /** Top-level work areas for helper registration (NOT inside partnerProfile). */
  helperWorkAreas: {
    type: [String],
    default: [],
  },
}, {
  timestamps: true
});

function normalizePersistedRoles(roles: unknown): Array<'tasker' | 'poster' | 'partner'> {
  if (!Array.isArray(roles)) return [];
  const normalized = new Set<'tasker' | 'poster' | 'partner'>();
  for (const rawRole of roles) {
    const role = String(rawRole || '').trim().toLowerCase();
    if (role === 'poster' || role === 'requester' || role === 'customer') {
      normalized.add('poster');
    }
    if (role === 'tasker' || role === 'performer' || role === 'helper') {
      normalized.add('tasker');
    }
    if (role === 'partner') {
      normalized.add('partner');
    }
    if (role === 'both') {
      normalized.add('poster');
      normalized.add('tasker');
    }
  }
  return Array.from(normalized).sort() as Array<'tasker' | 'poster' | 'partner'>;
}

function normalizeRolesInUpdate(update: Record<string, any> | null | undefined): void {
  if (!update || typeof update !== 'object') return;

  if (Object.prototype.hasOwnProperty.call(update, 'roles')) {
    update.roles = normalizePersistedRoles(update.roles);
  }
  if (update.$set && Object.prototype.hasOwnProperty.call(update.$set, 'roles')) {
    update.$set.roles = normalizePersistedRoles(update.$set.roles);
  }
}

export function normalizePartnerProfileForPersistence(partnerProfile: Record<string, any> | undefined | null): Record<string, any> | undefined {
  if (!partnerProfile || typeof partnerProfile !== 'object') {
    return undefined;
  }

  const normalized = { ...partnerProfile };
  if (Object.prototype.hasOwnProperty.call(normalized, 'workAreas')) {
    const rawWorkAreas = normalized.workAreas;
    if (Array.isArray(rawWorkAreas)) {
      normalized.workAreas = rawWorkAreas
        .filter((id: unknown) => typeof id === 'string' && id.trim())
        .map((id: string) => id.trim());
    } else if (typeof rawWorkAreas === 'string') {
      const trimmed = rawWorkAreas.trim();
      normalized.workAreas = trimmed ? [trimmed] : [];
    } else {
      normalized.workAreas = [];
    }
  }

  return normalized;
}

ProfileSchema.pre('save', function(next) {
  if (this.isModified('roles')) {
    this.roles = normalizePersistedRoles(this.roles) as any;
  }
  next();
});

ProfileSchema.pre('updateOne', function(next) {
  normalizeRolesInUpdate(this.getUpdate() as any);
  next();
});

ProfileSchema.pre('findOneAndUpdate', function(next) {
  normalizeRolesInUpdate(this.getUpdate() as any);
  next();
});

ProfileSchema.pre('updateMany', function(next) {
  normalizeRolesInUpdate(this.getUpdate() as any);
  next();
});

// Index for geospatial queries
ProfileSchema.index({ 'location.coordinates': '2dsphere' });
ProfileSchema.index({ 'homeLocation.coordinates': '2dsphere' });

// Compound indexes for efficient matching queries (notifications)
ProfileSchema.index({ 'skills.primaryCategory': 1, isActive: 1 });
ProfileSchema.index({ 'savedKeywords.keywords': 1, isActive: 1 });
ProfileSchema.index({ 'savedCategories.categories.slug': 1, isActive: 1 });

// Tasker matching (task-service queries by roles) and admin list sort
ProfileSchema.index({ roles: 1 });
ProfileSchema.index({ roles: 1, isActive: 1 });
ProfileSchema.index({ createdAt: -1 });
ProfileSchema.index({ status: 1, createdAt: -1 });

// Static method to calculate completion percentage
ProfileSchema.statics.calculateCompletionPercentage = function(profile: IProfile) {
  const fields = {
    name: !!profile.name,
    email: !!profile.email,
    phone: !!profile.phone,
    location: !!profile.location,
    roles: !!profile.roles && profile.roles.length > 0,
    skills: !!profile.skills && profile.skills.list && profile.skills.list.length > 0,
    photoURL: !!profile.photoURL
  };
  
  const completedFields = Object.keys(fields).filter(key => fields[key as keyof typeof fields]);
  const missingFields = Object.keys(fields).filter(key => !fields[key as keyof typeof fields]);
  const percentage = Math.round((completedFields.length / Object.keys(fields).length) * 100);
  
  return {
    percentage,
    completedFields,
    missingFields
  };
};

const Profile: Model<IProfile> = mongoose.model<IProfile>('Profile', ProfileSchema);

export type IProfileDocument = IProfile & Document;

export default Profile;
