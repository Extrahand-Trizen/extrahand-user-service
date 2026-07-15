import axios, { AxiosError } from 'axios';
import logger from '../config/logger';
import { validateEnv } from '../config/env';
import type { GrantSpec } from '../rewards/types/GrantSpec';
import {
  logReferralCoins,
  referralCoinsPaymentConfig,
  summarizeGrantsForLog,
} from '../rewards/referral/referralCoinsLogger';

export interface IssueGrantResultItem {
  success: boolean;
  idempotencyKey: string;
  duplicate?: boolean;
  error?: string;
}

export interface IssueGrantsClientResult {
  success: boolean;
  partial?: boolean;
  results?: IssueGrantResultItem[];
  error?: string;
}

function getPaymentClientConfig(): { baseURL: string; serviceAuthToken: string } {
  const env = validateEnv();
  return {
    baseURL: env.PAYMENT_SERVICE_URL || 'http://localhost:4003',
    serviceAuthToken: (env.SERVICE_AUTH_TOKEN || '').trim(),
  };
}

/**
 * PaymentServiceClient
 * HTTP client for payment-service issue-grants (ExtraCoins ledger).
 */
export class PaymentServiceClient {
  private static get headers() {
    const { serviceAuthToken } = getPaymentClientConfig();
    return {
      'x-service-auth': serviceAuthToken,
      'Content-Type': 'application/json',
    };
  }

  private static getBaseUrl(): string {
    return getPaymentClientConfig().baseURL.replace(/\/$/, '');
  }

  private static assertServiceAuth(): void {
    const { serviceAuthToken, baseURL } = getPaymentClientConfig();
    if (!serviceAuthToken) {
      logger.error('[PaymentServiceClient] SERVICE_AUTH_TOKEN is missing or empty', {
        baseURL,
      });
    }
  }

  static async issueGrants(
    grants: GrantSpec[],
    context?: { enrollmentId?: string }
  ): Promise<IssueGrantsClientResult> {
    this.assertServiceAuth();
    const baseURL = this.getBaseUrl();
    const cfg = referralCoinsPaymentConfig();
    const url = `${baseURL}/api/v1/transactions/issue-grants`;

    logReferralCoins('payment_client_issue_start', {
      enrollmentId: context?.enrollmentId,
      url,
      grantCount: grants.length,
      grantsPreview: summarizeGrantsForLog(grants),
      serviceAuthConfigured: cfg.serviceAuthConfigured,
      serviceAuthPreview: cfg.serviceAuthPreview,
    });

    try {
      const res = await axios.post(url, { grants }, { headers: this.headers, timeout: 15_000 });
      const data = res.data || {};
      const results = Array.isArray(data.results) ? data.results : [];
      const partial = Boolean(data.partial);
      const success = Boolean(data.success);

      logReferralCoins('payment_client_issue_done', {
        enrollmentId: context?.enrollmentId,
        httpStatus: res.status,
        success,
        partial,
        resultCount: results.length,
        results,
      });

      return { success, partial, results };
    } catch (err) {
      const axiosErr = err as AxiosError;
      const responseBody = axiosErr.response?.data;
      logReferralCoins(
        'payment_client_issue_error',
        {
          enrollmentId: context?.enrollmentId,
          url,
          httpStatus: axiosErr.response?.status,
          message: axiosErr.message,
          responseBody,
          serviceAuthConfigured: cfg.serviceAuthConfigured,
          hint:
            axiosErr.response?.status === 401 || axiosErr.response?.status === 403
              ? 'Check SERVICE_AUTH_TOKEN matches payment-service and PAYMENT_SERVICE_URL points to payment (port 4003)'
              : undefined,
        },
        'error'
      );
      logger.error('[PaymentServiceClient] issueGrants failed', {
        baseURL,
        status: axiosErr.response?.status,
        message: axiosErr.message,
        responseError: (responseBody as { error?: string })?.error,
      });
      return { success: false, partial: false, error: axiosErr.message, results: [] };
    }
  }
}
