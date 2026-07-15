export type PlatformEventType =
  | 'REFERRAL_ENROLLED'
  | 'GRANTS_REQUESTED'
  | 'GRANTS_ISSUED'
  | 'PAYMENT_COMPLETED'
  | 'TASK_COMPLETED'
  | 'IDENTITY_VERIFIED';

export interface PlatformEvent<T = Record<string, unknown>> {
  eventId: string;
  eventType: PlatformEventType;
  schemaVersion: string;
  occurredAt: string;
  correlationId: string;
  producer: string;
  payload: T;
}

export interface ReferralEnrolledPayload extends Record<string, unknown> {
  enrollmentId: string;
  referrerUid: string;
  refereeUid: string;
  referralCode: string;
}

export interface PaymentCompletedPayload extends Record<string, unknown> {
  taskId: string;
  posterUid: string;
  refereeUid?: string;
  performerUid?: string;
  amountInr: number;
  platformFeeInr: number;
}

export interface TaskCompletedPayload extends Record<string, unknown> {
  taskId: string;
  performerUid: string;
  posterUid: string;
  taskAmountInr: number;
}
