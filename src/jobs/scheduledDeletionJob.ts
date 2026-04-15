import logger from '../config/logger';
import { validateEnv } from '../config/env';
import { PrivacyService } from '../services/PrivacyService';

const DEFAULT_EXECUTION_INTERVAL_SECONDS = 5;
const MIN_EXECUTION_INTERVAL_SECONDS = 2;
const MAX_EXECUTION_INTERVAL_SECONDS = 30;

let isRunning = false;

function getExecutionIntervalMs(): number {
  const rawValue = Number(process.env.ACCOUNT_DELETION_EXECUTION_INTERVAL_SECONDS);
  const boundedSeconds = Number.isFinite(rawValue)
    ? Math.min(
        MAX_EXECUTION_INTERVAL_SECONDS,
        Math.max(MIN_EXECUTION_INTERVAL_SECONDS, Math.floor(rawValue))
      )
    : DEFAULT_EXECUTION_INTERVAL_SECONDS;

  return boundedSeconds * 1000;
}

async function runScheduledDeletionPass(): Promise<void> {
  if (isRunning) {
    return;
  }

  isRunning = true;

  try {
    const env = validateEnv();
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
  }
}

export function scheduleDeletionExecutorJob(): void {
  const intervalMs = getExecutionIntervalMs();

  // Run immediately at startup so already-due deletions are processed quickly.
  void runScheduledDeletionPass();

  setInterval(() => {
    void runScheduledDeletionPass();
  }, intervalMs);

  logger.info('Scheduled account deletion executor enabled', {
    intervalSeconds: Math.floor(intervalMs / 1000),
  });
}
