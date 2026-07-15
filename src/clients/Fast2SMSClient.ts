import axios from 'axios';
import logger from '../config/logger';

export class Fast2SMSClient {
  private static apiKey = '';
  private static baseURL = 'https://www.fast2sms.com/dev/bulkV2';
  private static isInitialized = false;

  static initialize(apiKey?: string): void {
    this.apiKey = apiKey || process.env.FAST2SMS_API_KEY || '';
    this.isInitialized = true;
    if (!this.apiKey) {
      logger.warn('Fast2SMSClient: FAST2SMS_API_KEY not set – SMS requests will be skipped');
    }
  }

  private static ensureInitialized(): void {
    if (!this.isInitialized) {
      this.initialize();
    }
  }

  private static validateAndNormalizePhone(phone: string): string | null {
    if (!phone || typeof phone !== 'string') return null;
    const digits = phone.replace(/\D/g, '');

    if (digits.length === 10 && digits[0] >= '6' && digits[0] <= '9') {
      return digits;
    }
    if (digits.length === 12 && digits.startsWith('91')) {
      const normalized = digits.slice(2);
      if (normalized[0] >= '6' && normalized[0] <= '9') return normalized;
    }
    return null;
  }

  static async sendSMS(
    phone: string,
    message: string,
    options?: { route?: 'q' | 'dlt' | 'v3'; sender_id?: string }
  ): Promise<boolean> {
    this.ensureInitialized();

    if (!this.apiKey) {
      logger.warn('Fast2SMSClient: Cannot send SMS - API key not configured');
      return false;
    }

    const normalizedPhone = this.validateAndNormalizePhone(phone);
    if (!normalizedPhone || !message?.trim()) {
      logger.warn('Fast2SMSClient: Invalid phone or empty message', { phone });
      return false;
    }

    try {
      const response = await axios.post(
        this.baseURL,
        {
          route: options?.route || 'q',
          sender_id: options?.sender_id || 'FSTSMS',
          message: message.trim(),
          language: 'english',
          flash: 0,
          numbers: normalizedPhone,
        },
        {
          headers: {
            authorization: this.apiKey,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        }
      );

      if (response.data?.return === true || response.data?.status_code === 200) {
        logger.info('Fast2SMSClient: SMS sent successfully', { phone: normalizedPhone });
        return true;
      }

      logger.error('Fast2SMSClient: SMS send failed', {
        phone: normalizedPhone,
        response: response.data,
      });
      return false;
    } catch (error: any) {
      logger.error('Fast2SMSClient: SMS request error', {
        phone: normalizedPhone,
        error: error?.message,
      });
      return false;
    }
  }
}
