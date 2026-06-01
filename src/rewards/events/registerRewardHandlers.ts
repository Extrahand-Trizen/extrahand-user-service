import { inProcessEventBus } from './InProcessEventBus';
import { QualificationEngine } from '../qualification/QualificationEngine';
import logger from '../../config/logger';

let registered = false;

export function registerRewardEventHandlers(): void {
  if (registered) return;
  registered = true;

  const handler = async (event: Parameters<typeof QualificationEngine.processDomainEvent>[0]) => {
    await QualificationEngine.processDomainEvent(event);
  };

  inProcessEventBus.subscribe('REFERRAL_ENROLLED', handler);
  inProcessEventBus.subscribe('PAYMENT_COMPLETED', handler);
  inProcessEventBus.subscribe('TASK_COMPLETED', handler);
  inProcessEventBus.subscribe('IDENTITY_VERIFIED', handler);

  logger.info(
    '[REFERRAL_COINS] rewards_handlers_ready — grep logs with [REFERRAL_COINS] after signup with referral code'
  );
  logger.info('[rewards] In-process event handlers registered');
}
