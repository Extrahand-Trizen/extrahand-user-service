import logger from '../config/logger';
import { validateEnv } from '../config/env';
import { PrivacyService } from '../services/PrivacyService';

const OVERLAP_RETRY_SECONDS = 2;
const DAILY_RUN_HOUR = 2;
const DAILY_RUN_MINUTE = 0;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

let isRunning = false;
let scheduledTimer: NodeJS.Timeout | null = null;
const env = validateEnv();

function getNextDailyRunAt(now: Date = new Date()): Date {
  const nextRun = new Date(now);
  nextRun.setHours(DAILY_RUN_HOUR, DAILY_RUN_MINUTE, 0, 0);

  if (nextRun.getTime() <= now.getTime()) {
    nextRun.setDate(nextRun.getDate() + 1);
  }

  return nextRun;
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
  try {
    const nextRunAt = getNextDailyRunAt();
    const delayMs = nextRunAt.getTime() - Date.now();
    scheduleNextRun(delayMs);

    logger.debug('Planned next daily scheduled deletion executor run', {
      nextRunAt,
      nextRunInSeconds: Math.max(0, Math.floor(delayMs / 1000)),
    });
  } catch (error: any) {
    scheduleNextRun(ONE_DAY_MS);
    logger.error('Failed to plan next scheduled deletion executor run', {
      error: error?.message || String(error),
      fallbackNextRunInSeconds: Math.floor(ONE_DAY_MS / 1000),
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
  void planNextRun();

  logger.info('Scheduled account deletion executor enabled', {
    dailyRunTime: `${String(DAILY_RUN_HOUR).padStart(2, '0')}:${String(DAILY_RUN_MINUTE).padStart(2, '0')}`,
    mode: 'daily',
  });
}
