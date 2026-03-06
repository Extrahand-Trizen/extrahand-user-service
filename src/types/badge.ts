/**
 * Badge & Reputation System Types and Interfaces
 * Manages user badges, reputation scores, and tier-based benefits
 */

export enum BadgeLevel {
  NONE = "none",              // New user - browse only
  BASIC = "basic",            // Email + phone verified
  VERIFIED = "verified",      // Aadhaar verified
  TRUSTED = "trusted",        // PAN + bank + 3 tasks + 4.0 rating
  ELITE = "elite"             // PAN + bank + 10 tasks + 4.5 rating + admin approved
}

export enum VerificationType {
  EMAIL = "email",
  PHONE = "phone",
  AADHAAR = "aadhaar_digilocker",
  PAN = "pan",
  BANK = "bank"
}

/**
 * Reputation Score Components (0-100 total)
 * - Verifications: 0-25 points (verified IDs/documents)
 * - Performance: 0-25 points (task completion rate)
 * - Reviews: 0-25 points (average rating quality)
 * - Reliability: 0-25 points (response time + cancellation rate)
 */
export interface ReputationScoreBreakdown {
  verifications: number;     // 0-25: email(3) + phone(3) + aadhaar(8) + pan(6) + bank(5)
  performance: number;       // 0-25: (completed_tasks / total_tasks) * 25
  reviews: number;           // 0-25: (avg_rating / 5) * 25
  reliability: number;       // 0-25: response_time_score + cancellation_rate_score
  total: number;             // Sum of all components, capped at 100
}

/**
 * Verification Record: Each user's verification status
 */
export interface VerificationRecord {
  _id?: string;
  userId: string;
  type: VerificationType;
  status: "pending" | "verified" | "rejected" | "expired";
  verifiedAt?: Date;
  expiresAt?: Date;
  
  // Document-specific fields
  documentId?: string;       // Reference number from verification service
  provider?: string;         // "digilocker" for Aadhaar, "manual" for PAN/bank
  
  // Manual verification fields
  verifiedBy?: string;       // Admin user ID who verified
  rejectionReason?: string;  // Why verification was rejected
}

/**
 * Badge Info: Current badge level and progress to next tier
 */
export interface BadgeInfo {
  _id?: string;
  userId: string;
  currentBadge: BadgeLevel;
  previousBadge?: BadgeLevel;
  badgeUpgradedAt?: Date;
  
  // Progress to next badge
  nextBadgeRequirements: BadgeRequirement[];
  progressPercentage: number; // 0-100 estimate of progress to next badge
}

/**
 * Badge Requirement: Criteria for each badge level
 */
export interface BadgeRequirement {
  badge: BadgeLevel;
  verifications: {
    required: VerificationType[];
    completed: VerificationType[];
  };
  taskCount: {
    required: number;
    current: number;
  };
  minRating: {
    required: number;
    current: number;
  };
  minReviews: {
    required: number;
    current: number;
  };
  maxResponseTime?: {
    required: string;         // e.g., "<6 hours" or "<2 hours"
    current: string;
  };
  minCompletionRate?: {
    required: number;         // percentage
    current: number;
  };
  manualApprovalRequired: boolean; // True only for ELITE
  manualApprovalBy?: string; // Admin user ID if approved
}

/**
 * User Badge Profile: Complete badge and reputation information
 */
export interface UserBadgeProfile {
  userId: string;
  currentBadge: BadgeLevel;
  reputationScore: ReputationScoreBreakdown;
  
  // Verification status
  verifications: VerificationRecord[];
  
  // Performance metrics
  totalTasksPosted: number;
  totalTasksCompleted: number;
  completionRate: number;    // percentage
  cancellationRate: number;  // percentage
  
  // Rating metrics
  averageRating: number;     // 0-5
  totalReviews: number;
  positiveReviews: number;   // 4+ stars
  negativeReviews: number;   // <4 stars
  
  // Reliability metrics
  averageResponseTime: number; // in minutes
  lastResponseAt?: Date;
  responseTimePercentile?: number; // How fast compared to other users
  
  // Fee benefit
  platformFeePercentage: number; // Determined by badge level
  
  // Badge history
  badgeHistory: BadgeHistoryEntry[];
  
  // Last check
  lastBadgeCheckAt: Date;
}

export interface BadgeHistoryEntry {
  badge: BadgeLevel;
  achievedAt: Date;
  reason: string;             // e.g., "Verified Aadhaar + 5 tasks completed"
  reputationScoreAtTime: number;
}

/**
 * Badge Tier Configuration: Fee reduction and benefits per tier
 */
export interface BadgeTierConfig {
  badge: BadgeLevel;
  name: string;
  platformFeePercentage: number;
  featuresBenefits: string[];
  minimumRequirements: Record<string, number | string | string[]>;
  description: string;
}

/**
 * Fee Structure by Badge
 */
export const FEE_STRUCTURE: Record<BadgeLevel, number> = {
  [BadgeLevel.NONE]: 0,        // Browse only, no fees
  [BadgeLevel.BASIC]: 5,       // 5%
  [BadgeLevel.VERIFIED]: 4.5,  // 4.5%
  [BadgeLevel.TRUSTED]: 4,     // 4%
  [BadgeLevel.ELITE]: 3        // 3%
};

/**
 * Badge Requirements Configuration
 */
export const BADGE_REQUIREMENTS: Record<BadgeLevel, Record<string, any>> = {
  [BadgeLevel.NONE]: {
    verifications: [],
    taskCount: 0,
    minRating: 0,
    minReviews: 0
  },
  [BadgeLevel.BASIC]: {
    verifications: ["email", "phone"],
    taskCount: 0,
    minRating: 0,
    minReviews: 0
  },
  [BadgeLevel.VERIFIED]: {
    verifications: ["email", "phone", "aadhaar_digilocker"],
    taskCount: 0,
    minRating: 0,
    minReviews: 0
  },
  [BadgeLevel.TRUSTED]: {
    verifications: ["email", "phone", "aadhaar_digilocker", "pan", "bank"],
    taskCount: 3,
    minRating: 4.0,
    minReviews: 0
  },
  [BadgeLevel.ELITE]: {
    verifications: ["email", "phone", "aadhaar_digilocker", "pan", "bank"],
    taskCount: 10,
    minRating: 4.5,
    minReviews: 0,
    manualApprovalRequired: true
  }
};
