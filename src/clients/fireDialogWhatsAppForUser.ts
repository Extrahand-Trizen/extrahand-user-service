import logger from '../config/logger';
import { DialogWhatsAppClient } from './DialogWhatsAppClient';

function normalizePhoneForDialog(raw: unknown): string | null {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return null;
  if (digits.length === 10) return `91${digits}`;
  return digits;
}

/**
 * Fire Dialog WhatsApp for a known phone (e.g. signup welcome).
 * Never throws.
 */
export function fireDialogWhatsAppForPhone(input: {
  uid: string;
  phone: string;
  eventKey: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
}): void {
  if (!DialogWhatsAppClient.isConfigured()) {
    logger.warn('Dialog WhatsApp skipped: not configured on user-service', {
      uid: input.uid,
      eventKey: input.eventKey,
      hint: 'Set DIALOG_WHATSAPP_ENABLED=true, DIALOG_SERVICE_URL, DIALOG_ORGANIZATION_ID',
    });
    return;
  }

  void (async () => {
    try {
      const phone = normalizePhoneForDialog(input.phone);
      if (!phone) {
        logger.warn('Dialog WhatsApp skipped: invalid phone', {
          uid: input.uid,
          eventKey: input.eventKey,
        });
        return;
      }

      await DialogWhatsAppClient.triggerNotification({
        eventKey: input.eventKey,
        recipientPhone: phone,
        payload: input.payload,
        idempotencyKey: input.idempotencyKey,
      });
    } catch (error: unknown) {
      logger.warn('Dialog WhatsApp fire error (non-fatal)', {
        uid: input.uid,
        eventKey: input.eventKey,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  })();
}
