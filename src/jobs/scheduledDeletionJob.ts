import logger from '../config/logger';
import { validateEnv } from '../config/env';
import { PrivacyService } from '../services/PrivacyService';

const DEFAULT_IDLE_CHECK_SECONDS = 300;
const MIN_IDLE_CHECK_SECONDS = 30;
const MAX_IDLE_CHECK_SECONDS = 3600;
const OVERLAP_RETRY_SECONDS = 2;

let isRunning = false;
let scheduledTimer: NodeJS.Timeout | null = null;
const env = validateEnv();

function getIdleCheckIntervalMs(): number {
  const rawValue = Number(process.env.ACCOUNT_DELETION_IDLE_CHECK_SECONDS);
  const boundedSeconds = Number.isFinite(rawValue)
    ? Math.min(
        MAX_IDLE_CHECK_SECONDS,
        Math.max(MIN_IDLE_CHECK_SECONDS, Math.floor(rawValue))
      )
    : DEFAULT_IDLE_CHECK_SECONDS;

  return boundedSeconds * 1000;
}

function scheduleNextRun(delayMs: number): void {
  const boundedDelayMs = Math.max(0, delayMs);

  if (scheduledTimer) {
    clearTimeout(scheduledTimer);
  }

  scheduledTimer = setTimeout(() => {
    void runScheduledDeletionPassAndPlanNext();
  }, boundedDelayMs);
}

async function planNextRun(): Promise<void> {
  const idleCheckIntervalMs = getIdleCheckIntervalMs();

  try {
    const nextScheduledDeletion = await PrivacyService.getNextScheduledDeletionTime();

    if (!nextScheduledDeletion) {
      scheduleNextRun(idleCheckIntervalMs);
      logger.debug('No pending account deletions. Sleeping executor.', {
        nextRunInSeconds: Math.floor(idleCheckIntervalMs / 1000),
      });
      return;
    }

    const delayMs = nextScheduledDeletion.getTime() - Date.now();
    scheduleNextRun(delayMs);

    logger.debug('Planned next scheduled deletion executor run', {
      nextScheduledFor: nextScheduledDeletion,
      nextRunInSeconds: Math.max(0, Math.floor(delayMs / 1000)),
    });
  } catch (error: any) {
    scheduleNextRun(idleCheckIntervalMs);
    logger.error('Failed to plan next scheduled deletion executor run', {
      error: error?.message || String(error),
      fallbackNextRunInSeconds: Math.floor(idleCheckIntervalMs / 1000),
    });
  }
}

async function runScheduledDeletionPassAndPlanNext(): Promise<void> {
  if (isRunning) {
    scheduleNextRun(OVERLAP_RETRY_SECONDS * 1000);
    return;
  }

  isRunning = true;

  try {
    const result = await PrivacyService.executeScheduledDeletions(
      env.TASK_SERVICE_URL,
      env.MESSAGING_SERVICE_URL,
      env.SERVICE_AUTH_TOKEN || ''
    );

    if (result.deletedCount > 0 || result.failedCount > 0) {
      logger.info('Scheduled deletion pass completed', {
        deletedCount: result.deletedCount,
        failedCount: result.failedCount,
      });
    }
  } catch (error: any) {
    logger.error('Scheduled deletion pass failed', {
      error: error?.message || String(error),
    });
  } finally {
    isRunning = false;
    await planNextRun();
  }
}

export function triggerDeletionExecutorWakeup(): void {
  scheduleNextRun(0);
}

export function scheduleDeletionExecutorJob(): void {
  triggerDeletionExecutorWakeup();

  logger.info('Scheduled account deletion executor enabled', {
    idleCheckIntervalSeconds: Math.floor(getIdleCheckIntervalMs() / 1000),
    mode: 'adaptive',
  });
}
