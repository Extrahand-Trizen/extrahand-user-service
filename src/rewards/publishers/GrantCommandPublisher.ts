import { PaymentServiceClient } from '../../clients/PaymentServiceClient';

import type { GrantSpec } from '../types/GrantSpec';

import logger from '../../config/logger';

import {

  grantsStatusFromSummary,

  markRefereeWelcomeCreditedIfIssued,

  summarizeGrantResults,

  updateEnrollmentGrantsStatus,

} from '../referral/grantEnrollmentTracker';

import { logReferralCoins, summarizeGrantsForLog } from '../referral/referralCoinsLogger';



export interface GrantPublishResult {

  success: boolean;

  partial: boolean;

  results: Array<{ success?: boolean; idempotencyKey?: string; error?: string }>;

  grantsFailed: number;

  grantsSucceeded: number;

}



/**

 * Executes grants via payment-service issue-grants (HTTP v1; queue-swappable later).

 */

export class GrantCommandPublisher {

  static async issueGrants(

    grants: GrantSpec[],

    options?: { enrollmentId?: string }

  ): Promise<GrantPublishResult> {

    if (!grants.length) {

      return { success: true, partial: false, results: [], grantsFailed: 0, grantsSucceeded: 0 };

    }



    logReferralCoins('publisher_issue_start', {

      enrollmentId: options?.enrollmentId,

      grantCount: grants.length,

      grantsPreview: summarizeGrantsForLog(grants),

    });



    const result = await PaymentServiceClient.issueGrants(grants, {

      enrollmentId: options?.enrollmentId,

    });

    const summary = summarizeGrantResults(result.results);

    const grantsStatus = grantsStatusFromSummary(summary);



    if (options?.enrollmentId) {
      await updateEnrollmentGrantsStatus(options.enrollmentId, grantsStatus);
      await markRefereeWelcomeCreditedIfIssued(
        options.enrollmentId,
        grants,
        result.results
      );
    }



    logReferralCoins(

      result.success && !result.partial ? 'publisher_issue_done' : 'publisher_issue_partial',

      {

        enrollmentId: options?.enrollmentId,

        grantsStatus,

        paymentSuccess: result.success,

        paymentPartial: result.partial,

        succeeded: summary.succeeded,

        failed: summary.failed,

        results: result.results,

      },

      result.success && !result.partial ? 'info' : 'warn'

    );



    if (!result.success || result.partial) {

      const failed = (result.results || []).filter((r) => !r.success);

      logger.warn('[GrantCommandPublisher] issueGrants partial or failed', {

        enrollmentId: options?.enrollmentId,

        partial: result.partial,

        failedKeys: failed.map((f) => f.idempotencyKey),

        errors: failed.map((f) => f.error),

      });

    }



    return {

      success: result.success,

      partial: Boolean(result.partial),

      results: result.results || [],

      grantsFailed: summary.failed,

      grantsSucceeded: summary.succeeded,

    };

  }

}


