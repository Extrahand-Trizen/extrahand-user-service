import { randomUUID } from 'crypto';
import type { EventHandler, EventPublisher } from './EventPublisher';
import type { PlatformEvent, PlatformEventType } from '../types/PlatformEvent';
import logger from '../../config/logger';

const handlers = new Map<PlatformEventType, Set<EventHandler>>();

export const inProcessEventBus: EventPublisher = {
  subscribe(eventType, handler) {
    if (!handlers.has(eventType)) {
      handlers.set(eventType, new Set());
    }
    handlers.get(eventType)!.add(handler);
  },

  async publish(event) {
    const set = handlers.get(event.eventType);
    if (!set || set.size === 0) return;

    for (const handler of set) {
      try {
        await handler(event);
      } catch (err) {
        logger.error('[EventBus] Handler failed', {
          eventType: event.eventType,
          eventId: event.eventId,
          err,
        });
      }
    }
  },
};

export function createPlatformEvent<T>(
  eventType: PlatformEventType,
  payload: T,
  correlationId?: string
): PlatformEvent<T> {
  return {
    eventId: randomUUID(),
    eventType,
    schemaVersion: '1.0',
    occurredAt: new Date().toISOString(),
    correlationId: correlationId || randomUUID(),
    producer: 'user-service',
    payload,
  };
}
