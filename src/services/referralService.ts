/**
 * Referral Service
 * Handles referral code generation, tracking, qualification, and credit management
 */

import { ReferralStatus, CreditTransactionType } from "../types/referral";
import { ReferralCode } from "../models/ReferralCode";
import { ReferralRecord } from "../models/ReferralRecord";
import { Credit } from "../models/Credit";

export class ReferralService {
  /**
   * Generate unique referral code: First 4 letters of name + 4 random alphanumeric
   * Example: JOHN2024, SARAHB7K9
   */
  static generateReferralCode(firstName: string): string {
    // Get first 4 letters, pad with A's if shorter
    const namePrefix = firstName.substring(0, 4).toUpperCase().padEnd(4, "A");
    
    // Generate 4 random alphanumeric characters
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let randomPart = "";
    for (let i = 0; i < 4; i++) {
      randomPart += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    return namePrefix + randomPart;
  }

  /**
   * Create referral code for new user (called on user signup)
   */
  static async createUserReferralCode(userId: string, firstName: string) {
    const code = this.generateReferralCode(firstName);
    
    const referralCode = await ReferralCode.create({
      code,
      userId
    });
    
    return referralCode;
  }

  /**
   * Create referral record when user signs up with referral code
   */
  static async createReferralRecord(
    referrerId: string,
    refereeId: string,
    referralCode: string
  ) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days later

    const record = await ReferralRecord.create({
      referrerId,
      refereeId,
      referralCode,
      status: ReferralStatus.PENDING,
      createdAt: now,
      expiresAt,
      referrerRewardAmount: 100,
      refereeRewardAmount: 50
    });

    return record;
  }

  /**
   * Qualify a referral: Called when referee completes ₹500+ task with payment processed within 30 days
   */
  static async qualifyReferral(
    referralRecordId: string,
    _taskId: string,
    taskAmount: number
  ): Promise<{ success: boolean; message?: string }> {
    // Validate minimum amount
    if (taskAmount < 500) {
      return { success: false, message: "Minimum task amount is ₹500" };
    }

    // Get referral record
    const record = await ReferralRecord.findById(referralRecordId);
    if (!record) {
      return { success: false, message: "Referral record not found" };
    }

    // Check if still within 30-day window
    if (new Date() > record.expiresAt) {
      await ReferralRecord.updateOne(
        { _id: referralRecordId },
        { status: ReferralStatus.EXPIRED }
      );
      return { success: false, message: "Referral expired" };
    }

    return { success: true };
  }

  /**
   * Check for expired referrals (daily batch job)
   */
  static async checkExpiredReferrals(): Promise<{ expiredCount: number; referralIds: string[] }> {
    const now = new Date();
    
    const result = await ReferralRecord.updateMany(
      {
        status: ReferralStatus.PENDING,
        expiresAt: { $lt: now }
      },
      {
        status: ReferralStatus.EXPIRED
      }
    );

    return {
      expiredCount: result.modifiedCount,
      referralIds: []
    };
  }

  /**
   * Get referral link for user
   */
  static getReferralLink(code: string): string {
    return `extrahand.in/signup?ref=${code}`;
  }

  /**
   * Validate referral code format (4 letters + 4 alphanumeric)
   */
  static isValidReferralCode(code: string): boolean {
    return /^[A-Z]{4}[A-Z0-9]{4}$/.test(code);
  }

  /**
   * Prevent self-referral: Verify that referrer and referee have different phone/email
   */
  static async validateNoSelfReferral(referrerId: string, refereeId: string): Promise<boolean> {
    // In actual implementation, fetch both users and compare email/phone
    return referrerId !== refereeId;
  }
}

/**
 * Credit Service
 * Manages credit balance, transactions, and usage
 */
export class CreditService {
  /**
   * Get or create credit account for user
   */
  static async getOrCreateCredit(userId: string) {
    let credit = await Credit.findOne({ userId });
    
    if (!credit) {
      credit = await Credit.create({
        userId,
        balance: 0,
        totalEarned: 0,
        totalUsed: 0,
        totalWithdrawn: 0,
        transactions: []
      });
    }

    return credit;
  }

  /**
   * Add credit to user's account (referral earnings, bonuses, etc.)
   */
  static async addCredit(
    userId: string,
    amount: number,
    type: CreditTransactionType,
    description: string,
    relatedId?: string
  ) {
    const transactionId = `TXN_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const transaction = {
      transactionId,
      type,
      amount,
      description,
      relatedId,
      status: "completed" as const,
      createdAt: new Date(),
      processedAt: new Date()
    };

    const credit = await Credit.findOneAndUpdate(
      { userId },
      {
        $push: { transactions: transaction },
        $inc: { 
          balance: amount,
          totalEarned: type.includes('earned') ? amount : 0
        },
        updatedAt: new Date()
      },
      { new: true, upsert: true }
    );

    return credit;
  }

  /**
   * Use credit for task payment
   */
  static async useCredit(
    userId: string,
    amount: number,
    taskId: string
  ): Promise<{ success: boolean; transactionId?: string; remainingBalance?: number }> {
    const credit = await Credit.findOne({ userId });
    
    if (!credit || credit.balance < amount) {
      return { success: false };
    }

    const transactionId = `TXN_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const transaction = {
      transactionId,
      type: CreditTransactionType.USED_PAYMENT,
      amount: -amount,
      description: `Payment for task ${taskId}`,
      relatedId: taskId,
      status: "completed" as const,
      createdAt: new Date(),
      processedAt: new Date()
    };

    const updated = await Credit.findOneAndUpdate(
      { userId },
      {
        $push: { transactions: transaction },
        $inc: { 
          balance: -amount,
          totalUsed: amount
        },
        updatedAt: new Date()
      },
      { new: true }
    );

    return {
      success: true,
      transactionId,
      remainingBalance: updated?.balance || 0
    };
  }

  /**
   * Use credit for fee reduction
   */
  static async useCreditForFeeReduction(
    userId: string,
    amount: number,
    taskId: string,
    platformFee: number
  ): Promise<{ success: boolean; newFeeAmount?: number }> {
    const credit = await Credit.findOne({ userId });
    
    if (!credit || credit.balance < amount) {
      return { success: false };
    }

    const newFeeAmount = Math.max(0, platformFee - amount);

    const transactionId = `TXN_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const transaction = {
      transactionId,
      type: CreditTransactionType.USED_FEE_REDUCTION,
      amount: -amount,
      description: `Fee reduction for task ${taskId}`,
      relatedId: taskId,
      status: "completed" as const,
      createdAt: new Date(),
      processedAt: new Date()
    };

    await Credit.findOneAndUpdate(
      { userId },
      {
        $push: { transactions: transaction },
        $inc: { 
          balance: -amount,
          totalUsed: amount
        },
        updatedAt: new Date()
      }
    );

    return {
      success: true,
      newFeeAmount
    };
  }

  /**
   * Withdraw credit to user's bank account (minimum ₹500)
   */
  static async withdrawCredit(
    userId: string,
    amount: number,
    bankAccountId: string
  ): Promise<{ success: boolean; transactionId?: string; message?: string }> {
    if (amount < 500) {
      return {
        success: false,
        message: "Minimum withdrawal amount is ₹500"
      };
    }

    const credit = await Credit.findOne({ userId });
    if (!credit || credit.balance < amount) {
      return {
        success: false,
        message: "Insufficient balance"
      };
    }

    const transactionId = `WD_${Date.now()}`;

    const transaction = {
      transactionId,
      type: CreditTransactionType.WITHDRAWN,
      amount: -amount,
      description: `Withdrawal to bank account ${bankAccountId}`,
      relatedId: bankAccountId,
      status: "pending" as const,
      createdAt: new Date()
    };

    await Credit.findOneAndUpdate(
      { userId },
      {
        $push: { transactions: transaction },
        $inc: { 
          balance: -amount,
          totalWithdrawn: amount
        },
        updatedAt: new Date()
      }
    );

    return {
      success: true,
      transactionId
    };
  }

  /**
   * Gift credit to another user
   */
  static async giftCredit(
    fromUserId: string,
    toUserId: string,
    amount: number,
    message?: string
  ): Promise<{ success: boolean; transactionId?: string }> {
    const fromCredit = await Credit.findOne({ userId: fromUserId });
    
    if (!fromCredit || fromCredit.balance < amount) {
      return { success: false };
    }

    const transactionId = `GIFT_${Date.now()}`;

    // Deduct from sender
    await Credit.findOneAndUpdate(
      { userId: fromUserId },
      {
        $push: {
          transactions: {
            transactionId,
            type: CreditTransactionType.GIFTED,
            amount: -amount,
            description: `Gift to user: ${message || 'No message'}`,
            relatedId: toUserId,
            status: "completed",
            createdAt: new Date(),
            processedAt: new Date()
          }
        },
        $inc: { 
          balance: -amount,
          totalUsed: amount
        },
        updatedAt: new Date()
      }
    );

    // Add to recipient
    await Credit.findOneAndUpdate(
      { userId: toUserId },
      {
        $push: {
          transactions: {
            transactionId: `${transactionId}_RECEIVED`,
            type: CreditTransactionType.GIFTED,
            amount,
            description: `Gift from user: ${message || 'No message'}`,
            relatedId: fromUserId,
            status: "completed",
            createdAt: new Date(),
            processedAt: new Date()
          }
        },
        $inc: { 
          balance: amount,
          totalEarned: amount
        },
        updatedAt: new Date()
      },
      { upsert: true }
    );

    return {
      success: true,
      transactionId
    };
  }

  /**
   * Get credit transaction history for user
   */
  static async getCreditTransactionHistory(
    userId: string,
    limit: number = 20,
    offset: number = 0
  ) {
    const credit = await Credit.findOne({ userId });
    
    if (!credit) {
      return [];
    }

    return credit.transactions
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(offset, offset + limit);
  }
}
