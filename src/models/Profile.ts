import mongoose, { Schema, Model, Document } from 'mongoose';
import { Location, OnboardingStatus, BusinessProfile, DataPrivacy } from '../types';

export interface IProfile extends Document {
  uid: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  roles: ('tasker' | 'requester' | 'both')[];
  userType: 'individual' | 'business';
  location?: Location | null;
  skills?: {
    primaryCategory?: string;
    list?: Array<{
      name: string;
      category?: string;
      level?: 'beginner' | 'intermediate' | 'expert';
      yearsOfExperience?: number;
      certified?: boolean;
      certificates?: Array<{
        title: string;
        issuedBy: string;
        issuedDate: Date;
        documentUrl: string;
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
  isPANVerified?: boolean;
  isBankVerified?: boolean;
  isFaceVerified?: boolean;
  isActive: boolean;
  photoURL?: string | null;
  onboardingStatus?: OnboardingStatus;
  business?: BusinessProfile;
  agreeUpdates?: boolean;
  agreeTerms?: boolean;
  dataPrivacy?: DataPrivacy;
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
    required: true,
    trim: true
  },
  email: {
    type: String,
    trim: true,
    lowercase: true
  },
  phone: {
    type: String,
    trim: true
  },
  roles: {
    type: [String],
    enum: ['tasker', 'requester', 'both'],
    default: ['both']
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
  skills: {
    primaryCategory: {
      type: String,
      enum: ['home_services', 'cleaning', 'delivery', 'beauty', 'tech', 'tutoring', 'other']
    },
    list: [{
      name: { type: String, required: true },
      category: String,
      level: {
        type: String,
        enum: ['beginner', 'intermediate', 'expert'],
        default: 'intermediate'
      },
      yearsOfExperience: Number,
      certified: { type: Boolean, default: false },
      certificates: [{
        title: String,
        issuedBy: String,
        issuedDate: Date,
        documentUrl: String
      }],
      verified: { type: Boolean, default: false }
    }],
    updatedAt: Date
  },
  rating: {
    type: Number,
    default: 0,
    min: 0,
    max: 5
  },
  totalReviews: {
    type: Number,
    default: 0
  },
  totalTasks: {
    type: Number,
    default: 0
  },
  completedTasks: {
    type: Number,
    default: 0
  },
  postedTasks: {
    type: Number,
    default: 0
  },
  earnedAmount: {
    type: Number,
    default: 0
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
  isPANVerified: {
    type: Boolean,
    default: false
  },
  isBankVerified: {
    type: Boolean,
    default: false
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
      number: String,
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
  dataPrivacy: {
    deletionRequested: { type: Boolean, default: false },
    deletionRequestedAt: Date,
    deletionScheduledFor: Date,
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
  }
}, {
  timestamps: true
});

// Index for geospatial queries
ProfileSchema.index({ 'location.coordinates': '2dsphere' });

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
