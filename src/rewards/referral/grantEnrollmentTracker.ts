import { ReferralRecord } from '../../models/ReferralRecord';
import type { ReferralGrantsStatus } from '../types/GrantsStatus';
import type { GrantSpec } from '../types/GrantSpec';
import { grantTargetsRefereeWelcome } from '../antiAbuse/services/ReferralConsumptionService';
import logger from '../../config/logger';

export interface GrantIssueSummary {
  total: number;
  succeeded: number;
  failed: number;
  partial: boolean;
}

export function summarizeGrantResults(
  results: Array<{ success?: boolean }> | undefined
): GrantIssueSummary {
  const list = results || [];
  const succeeded = list.filter((r) => r.success).length;
  const failed = list.filter((r) => !r.success).length;
  return {
    total: list.length,
    succeeded,
    failed,
    partial: succeeded > 0 && failed > 0,
  };
}

export function grantsStatusFromSummary(summary: GrantIssueSummary): ReferralGrantsStatus {
  if (summary.total === 0) return 'pending';
  if (summary.failed === 0) return 'completed';
  if (summary.succeeded === 0) return 'failed';
  return 'partial';
}

export async function updateEnrollmentGrantsStatus(
  enrollmentId: string,
  status: ReferralGrantsStatus
): Promise<void> {
  try {
    await ReferralRecord.updateOne(
      { _id: enrollmentId },
      {
        $set: {
          grantsStatus: status,
          lastGrantAttemptAt: new Date(),
          ...(status === 'failed' || status === 'partial' ? { lastGrantErrorAt: new Date() } : {}),
        },
      }
    );
  } catch (err) {
    logger.warn('[grantEnrollmentTracker] Failed to update grantsStatus', {
      enrollmentId,
      status,
      err,
    });
  }
}

/** Set refereeRewardCredited when a successful grant paid the referee signup welcome. */
export async function markRefereeWelcomeCreditedIfIssued(
  enrollmentId: string,
  grants: GrantSpec[],
  results: Array<{ success?: boolean }> | undefined
): Promise<void> {
  const list = results || [];
  const credited = grants.some(
    (grant, index) => list[index]?.success && grantTargetsRefereeWelcome(grant)
  );
  if (!credited) return;

  try {
    await ReferralRecord.updateOne(
      { _id: enrollmentId },
      { $set: { refereeRewardCredited: new Date() } }
    );
  } catch (err) {
    logger.warn('[grantEnrollmentTracker] Failed to set refereeRewardCredited', {
      enrollmentId,
      err,
    });
  }
}
