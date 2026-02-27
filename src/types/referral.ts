/**
 * Referral System Types and Interfaces
 * Manages user referral codes, tracking, and credit system
 */

export enum ReferralStatus {
  PENDING = "pending",       // User signed up with referral code, awaiting qualification
  QUALIFIED = "qualified",   // Completed ₹500+ task within 30 days with payment processed
  EXPIRED = "expired"        // 30 days passed without qualification
}

export enum CreditTransactionType {
  EARNED_REFERRAL = "earned_referral",
  EARNED_BONUS = "earned_bonus",
  USED_PAYMENT = "used_payment",
  USED_FEE_REDUCTION = "used_fee_reduction",
  WITHDRAWN = "withdrawn",
  GIFTED = "gifted",
  REFUNDED = "refunded"
}

/**
 * Referral Code: First 4 letters of name + 4 random characters
 * Example: JOHN2024, SARAH8B7K
 */
export interface ReferralCode {
  code: string;              // Unique referral code (e.g., JOHN2024)
  userId: string;            // User who owns this code
  createdAt: Date;           // When code was generated
}

/**
 * Referral Record: Tracks referrer-referee relationship and qualification status
 */
export interface ReferralRecord {
  _id?: string;
  referrerId: string;        // User who shared the referral code
  refereeId: string;         // User who signed up with the code
  referralCode: string;      // The code that was used
  status: ReferralStatus;    // pending | qualified | expired
  createdAt: Date;           // When referee signed up
  qualifiedDate?: Date;      // When qualification was achieved (task completed + payment)
  qualifyingTaskId?: string; // Task ID that resulted in qualification
  expiresAt: Date;           // 30 days after signup
  
  // Reward tracking
  referrerRewardAmount: number;  // Amount credited to referrer (₹100)
  refereeRewardAmount: number;   // Amount credited to referee (₹50)
  referrerRewardCredited?: Date; // When reward was issued
  refereeRewardCredited?: Date;  // When reward was issued
}

/**
 * Credit: Virtual currency earned through referrals and bonuses
 * Can be used to: pay for tasks, reduce platform fees, withdraw, gift
 */
export interface Credit {
  _id?: string;
  userId: string;
  balance: number;           // Current credit balance in ₹
  totalEarned: number;       // Lifetime credits earned
  totalUsed: number;         // Lifetime credits spent
  totalWithdrawn: number;    // Lifetime credits withdrawn
  transactions: CreditTransaction[];
}

export interface CreditTransaction {
  _id?: string;
  transactionId?: string;    // Unique transaction ID (optional for legacy data)
  type: CreditTransactionType;
  amount: number;            // Amount in ₹
  description: string;       // Details (e.g., "Referral bonus from JOHN2024", "Fee reduction on task ABC123")
  relatedId?: string;        // Related referral/task/payment ID
  status: "completed" | "pending" | "failed";
  createdAt: Date;
  processedAt?: Date;
}

/**
 * Referral Dashboard Data
 * Summary shown to user in referral section
 */
export interface ReferralDashboard {
  referralCode: string;
  referralLink: string;      // e.g., extrahand.in/signup?ref=JOHN2024
  totalReferrals: number;
  pendingReferrals: number;  // Awaiting 30-day window
  successfulReferrals: number; // Qualified (received reward)
  failedReferrals: number;   // Expired without qualifying
  
  totalEarnings: number;     // Total credits from referrals
  conversionRate: number;    // percentage: (successful / total) * 100
  
  creditBalance: number;
  recentTransactions: CreditTransaction[];
}

/**
 * Referral Share Options
 * Ways users can share their referral code
 */
export interface ShareOption {
  channel: "whatsapp" | "copy" | "email" | "facebook" | "twitter" | "linkedin";
  url?: string;              // Pre-filled share message/link
}
