/**
 * Badge & Reputation Calculation Service
 * Handles badge level calculations, reputation scoring, and tier upgrades
 */

import {
  BadgeLevel,
  BadgeTierConfig,
  BadgeInfo,
  UserBadgeProfile,
  ReputationScoreBreakdown,
  VerificationRecord,
  VerificationType,
  BADGE_REQUIREMENTS,
  FEE_STRUCTURE,
  BadgeHistoryEntry
} from "../types/badge";
import { IVerificationRecord } from "../models/VerificationRecord";

export class BadgeService {
  /**
   * Calculate reputation score (0-100) based on:
   * - Verifications (0-25): email +3, phone +3, aadhaar +8, pan +6, bank +5
   * - Performance (0-25): (completed / total tasks) * 25
   * - Reviews (0-25): (average rating / 5) * 25
   * - Reliability (0-25): response time score + cancellation rate score
   */
  static calculateReputationScore(profile: Partial<UserBadgeProfile>): ReputationScoreBreakdown {
    let verificationsScore = 0;
    let performanceScore = 0;
    let reviewsScore = 0;
    let reliabilityScore = 0;

    // 1. VERIFICATIONS SCORE (0-25)
    if (profile.verifications && Array.isArray(profile.verifications)) {
      const verified = (profile.verifications as IVerificationRecord[]).filter(v => v.status === "verified");
      verified.forEach(v => {
        switch (v.type) {
          case VerificationType.EMAIL:
            verificationsScore += 3;
            break;
          case VerificationType.PHONE:
            verificationsScore += 3;
            break;
          case VerificationType.AADHAAR:
            verificationsScore += 8;
            break;
          case VerificationType.PAN:
            verificationsScore += 6;
            break;
          case VerificationType.BANK:
            verificationsScore += 5;
            break;
        }
      });
    }
    verificationsScore = Math.min(verificationsScore, 25);

    // 2. PERFORMANCE SCORE (0-25)
    if (profile.totalTasksCompleted && profile.totalTasksPosted) {
      const completionRate = profile.totalTasksCompleted / profile.totalTasksPosted;
      performanceScore = Math.min(completionRate * 25, 25);
    }

    // 3. REVIEWS SCORE (0-25)
    if (profile.averageRating) {
      reviewsScore = Math.min((profile.averageRating / 5) * 25, 25);
    }

    // 4. RELIABILITY SCORE (0-25)
    let responseTimeScore = 0;
    if (profile.averageResponseTime) {
      const hours = profile.averageResponseTime / 60;
      if (hours <= 1) {
        responseTimeScore = 15;
      } else if (hours <= 6) {
        responseTimeScore = 15 - ((hours - 1) / 5) * 3;
      } else if (hours <= 24) {
        responseTimeScore = 12 - ((hours - 6) / 18) * 12;
      }
    }

    let cancellationScore = 10;
    if (profile.cancellationRate !== undefined) {
      if (profile.cancellationRate >= 10) {
        cancellationScore = 0;
      } else {
        cancellationScore = 10 - profile.cancellationRate;
      }
    }

    reliabilityScore = Math.min(responseTimeScore + cancellationScore, 25);

    const total = Math.min(
      verificationsScore + performanceScore + reviewsScore + reliabilityScore,
      100
    );

    return {
      verifications: Math.round(verificationsScore),
      performance: Math.round(performanceScore),
      reviews: Math.round(reviewsScore),
      reliability: Math.round(reliabilityScore),
      total: Math.round(total)
    };
  }

  /**
   * Determine badge level based on user profile
   * Returns both current badge and progress to next level
   */
  static determineBadgeLevel(profile: Partial<UserBadgeProfile>): BadgeLevel {
    // Log profile data for debugging
    console.log('🎖️ Determining badge level for profile:', {
      verifications: profile.verifications?.map(v => ({ type: v.type, status: v.status })),
      totalTasksCompleted: profile.totalTasksCompleted,
      averageRating: profile.averageRating,
      totalReviews: profile.totalReviews
    });

    // Check ELITE requirements
    if (this.checkBadgeRequirements(profile, BadgeLevel.ELITE)) {
      console.log('✨ Badge determined: ELITE');
      return BadgeLevel.ELITE;
    }

    // Check TRUSTED requirements
    if (this.checkBadgeRequirements(profile, BadgeLevel.TRUSTED)) {
      console.log('🥇 Badge determined: TRUSTED');
      return BadgeLevel.TRUSTED;
    }

    // Check VERIFIED requirements
    if (this.checkBadgeRequirements(profile, BadgeLevel.VERIFIED)) {
      console.log('🥈 Badge determined: VERIFIED');
      return BadgeLevel.VERIFIED;
    }

    // Check BASIC requirements
    if (this.checkBadgeRequirements(profile, BadgeLevel.BASIC)) {
      console.log('🥉 Badge determined: BASIC');
      return BadgeLevel.BASIC;
    }

    // Default to NONE
    console.log('⭐ Badge determined: NONE');
    return BadgeLevel.NONE;
  }

  /**
   * Check if user meets all requirements for a specific badge level
   */
  static checkBadgeRequirements(
    profile: Partial<UserBadgeProfile>,
    badgeLevel: BadgeLevel
  ): boolean {
    const requirements = BADGE_REQUIREMENTS[badgeLevel];

    // Check verifications
    if (requirements.verifications && requirements.verifications.length > 0) {
      const requiredVerifications = requirements.verifications;
      const userVerifications = profile.verifications || [];
      const verifiedTypes = userVerifications
        .filter(v => v.status === "verified")
        .map(v => v.type);

      const allVerified = requiredVerifications.every((req: string) => verifiedTypes.includes(req));
      console.log(`  📋 ${badgeLevel} - Verifications check:`, {
        required: requiredVerifications,
        verified: verifiedTypes,
        passed: allVerified
      });
      if (!allVerified) return false;
    }

    // Check task count
    if (requirements.taskCount && requirements.taskCount > 0) {
      const passed = (profile.totalTasksCompleted || 0) >= requirements.taskCount;
      console.log(`  📋 ${badgeLevel} - TaskCount check:`, {
        required: requirements.taskCount,
        actual: profile.totalTasksCompleted || 0,
        passed
      });
      if (!passed) return false;
    }

    // Check minimum rating
    if (requirements.minRating && requirements.minRating > 0) {
      const passed = (profile.averageRating || 0) >= requirements.minRating;
      console.log(`  📋 ${badgeLevel} - Rating check:`, {
        required: requirements.minRating,
        actual: profile.averageRating || 0,
        passed
      });
      if (!passed) return false;
    }

    // Check minimum reviews
    if (requirements.minReviews && requirements.minReviews > 0) {
      const passed = (profile.totalReviews || 0) >= requirements.minReviews;
      console.log(`  📋 ${badgeLevel} - Reviews check:`, {
        required: requirements.minReviews,
        actual: profile.totalReviews || 0,
        passed
      });
      if (!passed) return false;
    }

    // Check maximum response time (for TRUSTED and ELITE)
    if (requirements.maxResponseTime) {
      const maxMinutes =
        requirements.maxResponseTime === "6 hours" ? 360 : 120; // 6hrs or 2hrs
      if ((profile.averageResponseTime || Infinity) > maxMinutes) {
        return false;
      }
    }

    // Check minimum completion rate (for ELITE)
    if (requirements.minCompletionRate) {
      const completionRate =
        profile.totalTasksCompleted && profile.totalTasksPosted
          ? (profile.totalTasksCompleted / profile.totalTasksPosted) * 100
          : 0;
      if (completionRate < requirements.minCompletionRate) {
        return false;
      }
    }

    return true;
  }

  /**
   * Calculate progress percentage toward next badge level
   */
  static calculateProgressToNextBadge(
    profile: Partial<UserBadgeProfile>,
    currentBadge: BadgeLevel
  ): number {
    // Get next badge level
    const badgeOrder = [
      BadgeLevel.NONE,
      BadgeLevel.BASIC,
      BadgeLevel.VERIFIED,
      BadgeLevel.TRUSTED,
      BadgeLevel.ELITE
    ];
    const currentIndex = badgeOrder.indexOf(currentBadge);
    if (currentIndex === -1 || currentIndex === badgeOrder.length - 1) {
      return 100; // No next badge or already at ELITE
    }

    const nextBadge = badgeOrder[currentIndex + 1];
    const nextRequirements = BADGE_REQUIREMENTS[nextBadge];

    // Simple progress calculation based on verifications and tasks
    let progressItems = 0;
    let completedItems = 0;

    // Check verifications progress
    if (nextRequirements.verifications && nextRequirements.verifications.length > 0) {
      const requiredCount = nextRequirements.verifications.length;
      const verifiedCount = (profile.verifications || []).filter(
        v => v.status === "verified"
      ).length;

      progressItems += requiredCount;
      completedItems += Math.min(verifiedCount, requiredCount);
    }

    // Check task progress
    if (nextRequirements.taskCount && nextRequirements.taskCount > 0) {
      progressItems += 1; // Weight task completion as 1 item
      const taskProgress = Math.min(
        ((profile.totalTasksCompleted || 0) / nextRequirements.taskCount) * 1,
        1
      );
      completedItems += taskProgress;
    }

    // If no items to track, assume 100% progress (shouldn't happen in practice)
    if (progressItems === 0) return 100;

    const progressPercentage = Math.round((completedItems / progressItems) * 100);
    return Math.min(progressPercentage, 99); // Cap at 99% until fully qualified
  }

  /**
   * Get badge tier configuration with features and benefits
   */
  static getBadgeTierConfig(badge: BadgeLevel): BadgeTierConfig {
    const configs: Record<BadgeLevel, BadgeTierConfig> = {
      [BadgeLevel.NONE]: {
        badge: BadgeLevel.NONE,
        name: "New User",
        platformFeePercentage: 0,
        featuresBenefits: ["Browse all tasks", "Complete profile before applying"],
        minimumRequirements: { verifications: "None" },
        description: "Get started with ExtraHand by completing email and phone verification"
      },
      [BadgeLevel.BASIC]: {
        badge: BadgeLevel.BASIC,
        name: "Basic Member",
        platformFeePercentage: FEE_STRUCTURE[BadgeLevel.BASIC],
        featuresBenefits: ["Apply and post tasks", "5% platform fee", "Basic support"],
        minimumRequirements: {
          verifications: ["email", "phone"]
        },
        description:
          "You can now apply for tasks and post your first task requests"
      },
      [BadgeLevel.VERIFIED]: {
        badge: BadgeLevel.VERIFIED,
        name: "Verified",
        platformFeePercentage: FEE_STRUCTURE[BadgeLevel.VERIFIED],
        featuresBenefits: [
          "Priority in app visibility",
          "4.5% platform fee",
          "Add custom rates (up to +10%)",
          "Verified badge on profile",
          "Email support"
        ],
        minimumRequirements: {
          verifications: ["email", "phone", "aadhaar"],
          completedTasks: 5,
          minimumRating: 4.0
        },
        description:
          "Your identity is verified. Enjoy better visibility and lower fees"
      },
      [BadgeLevel.TRUSTED]: {
        badge: BadgeLevel.TRUSTED,
        name: "Trusted",
        platformFeePercentage: FEE_STRUCTURE[BadgeLevel.TRUSTED],
        featuresBenefits: [
          "Featured on platform",
          "4% platform fee",
          "Instant payouts",
          "Custom pricing",
          "<6 hour response time",
          "10+ verified reviews",
          "Direct support"
        ],
        minimumRequirements: {
          verifications: ["email", "phone", "aadhaar", "pan", "bank"],
          completedTasks: 25,
          minimumRating: 4.5,
          minimumReviews: 10,
          maxResponseTime: "6 hours"
        },
        description:
          "Elite performers only. Enjoy maximum visibility, lower fees, and instant payouts"
      },
      [BadgeLevel.ELITE]: {
        badge: BadgeLevel.ELITE,
        name: "Elite",
        platformFeePercentage: FEE_STRUCTURE[BadgeLevel.ELITE],
        featuresBenefits: [
          "3% platform fee",
          "Featured on homepage",
          "Exclusive high-value tasks",
          "24/7 dedicated support",
          "Priority payment processing",
          "Instant payouts",
          "Custom rates"
        ],
        minimumRequirements: {
          verifications: ["email", "phone", "aadhaar", "pan", "bank"],
          completedTasks: 100,
          minimumRating: 4.8,
          minimumReviews: 50,
          maxResponseTime: "2 hours",
          minimumCompletionRate: "95%",
          requiresAdminApproval: true
        },
        description:
          "The highest tier. Only for exceptional performers with admin approval"
      }
    };

    return configs[badge];
  }

  /**
   * Check user for badge upgrade after task completion or daily batch
   * Returns previous badge, new badge, and whether upgrade occurred
   */
  static async checkAndUpgradeBadge(
    userId: string,
    profile: Partial<UserBadgeProfile>
  ): Promise<{ upgraded: boolean; previousBadge?: BadgeLevel; newBadge?: BadgeLevel; reason?: string }> {
    const currentBadge = profile.currentBadge || BadgeLevel.NONE;
    const newBadge = this.determineBadgeLevel(profile);

    if (newBadge !== currentBadge) {
      return {
        upgraded: true,
        previousBadge: currentBadge,
        newBadge,
        reason: `Qualified for ${newBadge} badge`
      };
    }

    return { upgraded: false };
  }

  /**
   * Add badge history entry when upgrade occurs
   */
  static createBadgeHistoryEntry(
    badge: BadgeLevel,
    reputationScore: number,
    reason: string
  ): BadgeHistoryEntry {
    return {
      badge,
      achievedAt: new Date(),
      reason,
      reputationScoreAtTime: reputationScore
    };
  }

  /**
   * Get platform fee percentage for a badge level
   */
  static getPlatformFeePercentage(badge: BadgeLevel): number {
    return FEE_STRUCTURE[badge];
  }

  /**
   * Validate Elite badge requirements require manual admin approval only
   * Regular upgrades (NONE→BASIC→VERIFIED→TRUSTED) are automatic
   */
  static requiresManualApproval(badge: BadgeLevel): boolean {
    return badge === BadgeLevel.ELITE;
  }
}

/**
 * Batch Job Service
 * Runs daily to check all users for badge upgrades
 */
export class BadgeBatchService {
  /**
   * Daily batch job to check and update badges for all users
   * Should run once daily at off-peak hours (e.g., 2 AM IST)
   */
  static async runDailyBadgeCheck(): Promise<{
    processedUsers: number;
    upgradedUsers: number;
    upgrades: Array<{ userId: string; from: BadgeLevel; to: BadgeLevel }>;
  }> {
    // In actual implementation:
    // 1. Get all users
    // 2. For each user, calculate current badge level
    // 3. Compare with stored badge level
    // 4. If different, update and notify user (except manual approval ones)
    // 5. Return summary

    return {
      processedUsers: 0,
      upgradedUsers: 0,
      upgrades: []
    };
  }

  /**
   * Check single user for badge upgrade (called after task completion)
   * This is event-driven, so can happen multiple times per day
   */
  static async checkUserBadgeUpgrade(userId: string): Promise<{
    upgraded: boolean;
    previousBadge?: BadgeLevel;
    newBadge?: BadgeLevel;
  }> {
    // In actual implementation:
    // 1. Get user profile with all required fields
    // 2. Call BadgeService.checkAndUpgradeBadge()
    // 3. Update database if upgraded
    // 4. Send notification to user if upgraded
    // 5. Return result

    return { upgraded: false };
  }
}
