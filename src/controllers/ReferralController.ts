import { Response } from 'express';
import { AuthenticatedRequest } from '../types';
import logger from '../config/logger';
import { ReferralCode } from '../models/ReferralCode';
import { ReferralRecord } from '../models/ReferralRecord';
import { Credit } from '../models/Credit';
import { Profile } from '../models/Profile';
import { ReferralService, CreditService } from '../services/referralService';
import { CreditTransactionType, ReferralStatus } from '../types/referral';

export class ReferralController {
  /**
   * GET /api/v1/user/referral-code
   */
  static async getUserReferralCode(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const uid = req.user!.uid;
      const profile = await Profile.findOne({ uid });

      if (!profile) {
        res.status(404).json({ success: false, error: 'Profile not found' });
        return;
      }

      let referralCode = await ReferralCode.findOne({ userId: profile._id });

      if (!referralCode) {
        const code = ReferralService.generateReferralCode(profile.name);
        referralCode = await ReferralCode.create({
          code,
          userId: profile._id
        });
      }

      res.json({
        success: true,
        data: {
          code: referralCode.code,
          userId: referralCode.userId,
          createdAt: referralCode.createdAt,
          referralLink: ReferralService.getReferralLink(referralCode.code)
        }
      });
    } catch (error: any) {
      logger.error('Error getting referral code:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * GET /api/v1/user/referral-dashboard
   */
  static async getReferralDashboard(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const uid = req.user!.uid;
      const limit = parseInt(req.query.limit as string) || 20;
      const offset = parseInt(req.query.offset as string) || 0;

      const profile = await Profile.findOne({ uid });
      if (!profile) {
        res.status(404).json({ success: false, error: 'Profile not found' });
        return;
      }

      const referralCode = await ReferralCode.findOne({ userId: profile._id });
      if (!referralCode) {
        res.status(404).json({ success: false, error: 'Referral code not found' });
        return;
      }

      const allReferrals = await ReferralRecord.find({ referrerId: profile._id });
      const totalReferrals = allReferrals.length;
      const pendingReferrals = allReferrals.filter(r => r.status === ReferralStatus.PENDING).length;
      const successfulReferrals = allReferrals.filter(r => r.status === ReferralStatus.QUALIFIED).length;
      const failedReferrals = allReferrals.filter(r => r.status === ReferralStatus.EXPIRED).length;

      const totalEarnings = successfulReferrals * 100; // ₹100 per successful referral
      const conversionRate = totalReferrals > 0 ? Math.round((successfulReferrals / totalReferrals) * 100) : 0;

      const credits = await Credit.findOne({ userId: profile._id });
      const creditBalance = credits?.balance || 0;

      const transactions = credits?.transactions.slice(offset, offset + limit) || [];

      res.json({
        success: true,
        data: {
          referralCode: referralCode.code,
          referralLink: ReferralService.getReferralLink(referralCode.code),
          totalReferrals,
          pendingReferrals,
          successfulReferrals,
          failedReferrals,
          totalEarnings,
          conversionRate,
          creditBalance,
          recentTransactions: transactions
        }
      });
    } catch (error: any) {
      logger.error('Error getting referral dashboard:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * POST /api/v1/referral/qualify
   * Called by Payment Service after task payment
   */
  static async qualifyReferral(req: any, res: Response): Promise<void> {
    try {
      const serviceToken = req.headers['x-service-token'];
      if (serviceToken !== process.env.SERVICE_AUTH_TOKEN) {
        res.status(401).json({ success: false, error: 'Invalid service token' });
        return;
      }

      const { taskId, refereeId, referralCode, taskAmount } = req.body;

      if (taskAmount < 500) {
        res.status(400).json({ success: false, error: 'Task amount must be at least ₹500' });
        return;
      }

      const referralRecord = await ReferralRecord.findOne({
        referralCode,
        refereeId,
        status: ReferralStatus.PENDING
      });

      if (!referralRecord) {
        res.status(404).json({ success: false, error: 'Referral record not found' });
        return;
      }

      if (new Date() > referralRecord.expiresAt) {
        await ReferralRecord.updateOne({ _id: referralRecord._id }, { status: ReferralStatus.EXPIRED });
        res.status(409).json({ success: false, error: 'Referral expired' });
        return;
      }

      // Update referral record
      const now = new Date();
      await ReferralRecord.updateOne(
        { _id: referralRecord._id },
        {
          status: ReferralStatus.QUALIFIED,
          qualifiedDate: now,
          qualifyingTaskId: taskId,
          referrerRewardCredited: now,
          refereeRewardCredited: now
        }
      );

      // Issue credits to referrer
      await CreditService.addCredit(
        referralRecord.referrerId.toString(),
        100,
        CreditTransactionType.EARNED_REFERRAL,
        `Referral bonus - User completed ₹${taskAmount} task`
      );

      // Issue credits to referee
      await CreditService.addCredit(
        refereeId,
        50,
        CreditTransactionType.EARNED_REFERRAL,
        `Welcome bonus for signing up with referral code ${referralCode}`
      );

      logger.info('✅ Referral qualified', {
        referralCode,
        referrerId: referralRecord.referrerId.toString(),
        refereeId,
        taskId
      });

      res.json({
        success: true,
        data: {
          referralId: referralRecord._id,
          status: ReferralStatus.QUALIFIED,
          referrerCredit: 100,
          refereeCredit: 50,
          feeReduction: 3,
          creditsIssuedAt: now
        }
      });
    } catch (error: any) {
      logger.error('Error qualifying referral:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * GET /api/v1/user/credits/balance
   */
  static async getCreditBalance(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const uid = req.user!.uid;
      const profile = await Profile.findOne({ uid });

      if (!profile) {
        res.status(404).json({ success: false, error: 'Profile not found' });
        return;
      }

      let credit = await Credit.findOne({ userId: profile._id });

      if (!credit) {
        credit = await Credit.create({
          userId: profile._id,
          balance: 0,
          totalEarned: 0,
          totalUsed: 0,
          totalWithdrawn: 0,
          transactions: []
        });
      }

      res.json({
        success: true,
        data: {
          userId: credit.userId,
          balance: credit.balance,
          totalEarned: credit.totalEarned,
          totalUsed: credit.totalUsed,
          totalWithdrawn: credit.totalWithdrawn
        }
      });
    } catch (error: any) {
      logger.error('Error getting credit balance:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * GET /api/v1/user/credits/transactions
   */
  static async getTransactionHistory(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const uid = req.user!.uid;
      const limit = parseInt(req.query.limit as string) || 20;
      const offset = parseInt(req.query.offset as string) || 0;
      const type = req.query.type as string;
      const status = req.query.status as string;

      const profile = await Profile.findOne({ uid });
      if (!profile) {
        res.status(404).json({ success: false, error: 'Profile not found' });
        return;
      }

      const credit = await Credit.findOne({ userId: profile._id });

      if (!credit) {
        res.json({ success: true, data: { total: 0, transactions: [] } });
        return;
      }

      let transactions = credit.transactions;

      if (type) {
        transactions = transactions.filter(t => t.type === type);
      }
      if (status) {
        transactions = transactions.filter(t => t.status === status);
      }

      transactions = transactions.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      const paginated = transactions.slice(offset, offset + limit);

      res.json({
        success: true,
        data: {
          total: transactions.length,
          transactions: paginated
        }
      });
    } catch (error: any) {
      logger.error('Error getting transaction history:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * POST /api/v1/user/credits/use-payment
   */
  static async useCredit(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const uid = req.user!.uid;
      const { taskId, amount } = req.body;

      const profile = await Profile.findOne({ uid });
      if (!profile) {
        res.status(404).json({ success: false, error: 'Profile not found' });
        return;
      }

      const result = await CreditService.useCredit(profile._id.toString(), amount, taskId);

      if (result.success) {
        res.json({ success: true, data: result });
      } else {
        res.status(402).json({ success: false, error: 'Insufficient credits' });
      }
    } catch (error: any) {
      logger.error('Error using credit:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * POST /api/v1/user/credits/gift
   */
  static async giftCredit(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const fromUid = req.user!.uid;
      const { recipientUserId, amount, message } = req.body;

      const fromProfile = await Profile.findOne({ uid: fromUid });
      if (!fromProfile) {
        res.status(404).json({ success: false, error: 'Profile not found' });
        return;
      }

      if (fromProfile._id.toString() === recipientUserId) {
        res.status(400).json({ success: false, error: 'Cannot gift to self' });
        return;
      }

      const result = await CreditService.giftCredit(
        fromProfile._id.toString(),
        recipientUserId,
        amount,
        message
      );

      if (result.success) {
        res.json({ success: true, data: result });
      } else {
        res.status(400).json({ success: false, error: 'Gift failed' });
      }
    } catch (error: any) {
      logger.error('Error gifting credit:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }
}
