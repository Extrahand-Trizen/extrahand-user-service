import cron from 'node-cron';
import logger from '../config/logger';
import { LocationNotifyService } from '../services/LocationNotifyService';

export async function runLocationNotifyJob(): Promise<void> {
  try {
    logger.info('Starting location notify job...');
    const result = await LocationNotifyService.processActiveRequests(200);
    logger.info('Location notify job completed', result);
  } catch (error: any) {
    logger.error('Location notify job failed', {
      error: error?.message || String(error),
    });
  }
}

/** Check active location notify requests every 30 minutes. */
export function scheduleLocationNotifyJob(): void {
  cron.schedule('*/30 * * * *', async () => {
    await runLocationNotifyJob();
  });
  logger.info('Scheduled location notify job (every 30 minutes)');
}
