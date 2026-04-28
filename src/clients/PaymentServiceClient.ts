import axios, { AxiosError } from 'axios';
import logger from '../config/logger';

/**
 * PaymentServiceClient
 * HTTP client for calling payment-service APIs from user-service.
 * Used to award ExtraCoins for referral events.
 */
export class PaymentServiceClient {
  private static baseURL: string = process.env.PAYMENT_SERVICE_URL || 'http://localhost:4002';
  private static serviceAuthToken: string = process.env.SERVICE_AUTH_TOKEN || '';

  private static get headers() {
    return {
      'x-service-auth': this.serviceAuthToken,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Award referral ExtraCoins.
   * type='signup'    → ₹25 coins to referrer + ₹15 welcome coins to referee
   * type='task_bonus' → 20% of platform fee coins to referrer
   */
  static async awardReferralCoins(params: {
    type: 'signup' | 'task_bonus';
    referrerUid: string;
    refereeUid: string;
    referralCode: string;
    taskId?: string;
    platformFeeRupees?: number | string;
  }): Promise<{ success: boolean; error?: string }> {
    try {
      const res = await axios.post(
        `${this.baseURL}/api/v1/transactions/award-referral-coins`,
        params,
        { headers: this.headers, timeout: 10_000 }
      );
      logger.info('[PaymentServiceClient] awardReferralCoins success', {
        type: params.type,
        referrerUid: params.referrerUid,
        refereeUid: params.refereeUid,
        response: res.data,
      });
      return { success: true };
    } catch (err) {
      const axiosErr = err as AxiosError;
      logger.error('[PaymentServiceClient] awardReferralCoins failed', {
        type: params.type,
        referrerUid: params.referrerUid,
        refereeUid: params.refereeUid,
        status: axiosErr.response?.status,
        data: axiosErr.response?.data,
        message: axiosErr.message,
      });
      // Non-critical: referral coins failing should not break the signup/qualification flow
      return { success: false, error: axiosErr.message };
    }
  }
}
