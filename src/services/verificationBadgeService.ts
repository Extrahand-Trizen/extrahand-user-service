/**
 * Verification Badge Service
 * Handles automatic badge tier calculation based on completed verifications
 */

import Profile from '../models/Profile';
import { VerificationRecord } from '../models/VerificationRecord';
import { VerificationType } from '../types/badge';
import logger from '../config/logger';
import { BadgeNotificationService } from './badgeNotificationService';

export interface VerificationBadgeResult {
  tier: number;
  badge: 'none' | 'basic' | 'verified' | 'trusted';
  description: string;
}

export class VerificationBadgeService {
  /**
   * Calculate verification tier and badge based on completed verifications
   * 
   * Individual User Tiers:
   * - Tier 0 (None): No verifications
   * - Tier 1 (Basic): Email OR Phone verified
   * - Tier 2 (Verified): Aadhaar verified
   * - Tier 3 (Trusted): Aadhaar + PAN + Bank verified
   */
  static async calculateVerificationBadge(uid: string): Promise<VerificationBadgeResult> {
    try {
      const profile = await Profile.findOne({ uid });
      if (!profile) {
        throw new Error('Profile not found');
      }

      const hasEmail = !!profile.email || profile.isEmailVerified === true;
      const hasPhone = !!profile.phone || profile.phoneVerified === true;
      const hasAadhaar = profile.isAadhaarVerified === true;
      const hasPAN = profile.isPANVerified === true;
      const hasBank = profile.isBankVerified === true;

      // Tier 3 (Trusted): Aadhaar + PAN + Bank
      if (hasAadhaar && hasPAN && hasBank) {
        return {
          tier: 3,
          badge: 'trusted',
          description: 'Fully verified - can receive payments'
        };
      }

      // Tier 2 (Verified): Aadhaar verified
      if (hasAadhaar) {
        return {
          tier: 2,
          badge: 'verified',
          description: 'Identity confirmed'
        };
      }

      // Tier 1 (Basic): Email OR Phone
      if (hasEmail || hasPhone) {
        return {
          tier: 1,
          badge: 'basic',
          description: 'Basic account security'
        };
      }

      // Tier 0 (None): No verifications
      return {
        tier: 0,
        badge: 'none',
        description: 'New user, not verified'
      };
    } catch (error: any) {
      logger.error('Error calculating verification badge:', error);
      throw error;
    }
  }

  /**
   * Update profile with new verification tier and badge
   */
  static async updateProfileBadge(uid: string): Promise<VerificationBadgeResult> {
    try {
      const profile = await Profile.findOne({ uid });
      if (!profile) {
        throw new Error('Profile not found');
      }

      const previousBadge = profile.verificationBadge || 'none';
      const previousTier = profile.verificationTier || 0;
      
      const badgeResult = await this.calculateVerificationBadge(uid);

      // Only update if badge changed
      if (badgeResult.badge !== previousBadge) {
        await Profile.findOneAndUpdate(
          { uid },
          {
            verificationTier: badgeResult.tier,
            verificationBadge: badgeResult.badge,
            lastVerifiedAt: new Date()
          },
          { new: true }
        );

        logger.info(`✅ Updated verification badge for ${uid}`, {
          tier: badgeResult.tier,
          badge: badgeResult.badge,
          previousBadge,
          previousTier
        });

        // 🔔 Send badge upgrade notification
        if (badgeResult.tier > previousTier) {
          try {
            await BadgeNotificationService.sendBadgeUpgradeNotification({
              userId: profile._id.toString(),
              uid: profile.uid,
              name: profile.name,
              previousBadge,
              newBadge: badgeResult.badge,
              newTier: badgeResult.tier
            });
          } catch (notifError: any) {
            logger.error('Failed to send badge upgrade notification', notifError);
            // Don't throw - notification failures shouldn't block badge updates
          }
        }
      }

      return badgeResult;
    } catch (error: any) {
      logger.error('Error updating profile badge:', error);
      throw error;
    }
  }

  /**
   * Create or update verification record
   */
  static async upsertVerificationRecord(
    userId: string,
    type: VerificationType,
    status: 'pending' | 'verified' | 'rejected' | 'expired',
    options?: {
      documentId?: string;
      provider?: string;
      verifiedBy?: string;
      rejectionReason?: string;
    }
  ): Promise<void> {
    try {
      const recordData: any = {
        userId,
        type,
        status,
        ...options
      };

      if (status === 'verified') {
        recordData.verifiedAt = new Date();
      }

      await VerificationRecord.findOneAndUpdate(
        { userId, type },
        recordData,
        { upsert: true, new: true }
      );

      logger.info(`✅ Updated verification record for ${userId}`, {
        type,
        status
      });
    } catch (error: any) {
      logger.error('Error upserting verification record:', error);
      throw error;
    }
  }

  /**
   * Update verification and badge in one transaction
   */
  static async handleVerificationComplete(
    uid: string,
    userId: string,
    type: VerificationType,
    options?: {
      documentId?: string;
      provider?: string;
    }
  ): Promise<VerificationBadgeResult> {
    try {
      // Create/update verification record
      await this.upsertVerificationRecord(userId, type, 'verified', options);

      // Update badge tier
      const badgeResult = await this.updateProfileBadge(uid);

      logger.info(`🎖️ Verification complete and badge updated`, {
        uid,
        type,
        newTier: badgeResult.tier,
        newBadge: badgeResult.badge
      });

      return badgeResult;
    } catch (error: any) {
      logger.error('Error handling verification complete:', error);
      throw error;
    }
  }
}
