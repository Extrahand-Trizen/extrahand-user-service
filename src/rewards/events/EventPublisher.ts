import type { PlatformEvent } from '../types/PlatformEvent';

export type EventHandler = (event: PlatformEvent) => void | Promise<void>;

export interface EventPublisher {
  publish(event: PlatformEvent): Promise<void>;
  subscribe(eventType: PlatformEvent['eventType'], handler: EventHandler): void;
}
