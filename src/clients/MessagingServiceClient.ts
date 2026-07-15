import axios, { AxiosError } from 'axios';
import logger from '../config/logger';
import { validateEnv } from '../config/env';
import { messagingServiceCircuit } from '../utils/CircuitBreaker';

export class MessagingServiceClient {
  private static baseURL = '';
  private static token = '';

  static initialize(): void {
    const env = validateEnv();
    this.baseURL = (
      process.env.MESSAGING_SERVICE_URL || 'http://localhost:4010'
    ).replace(/\/$/, '');
    this.token = env.SERVICE_AUTH_TOKEN || '';
  }

  static async sendSignupWelcome(args: {
    uid: string;
    name?: string;
    email?: string;
    role?: string;
    templateBody?: Record<string, string>;
  }): Promise<boolean> {
    if (!this.token) {
      logger.warn('MessagingServiceClient: SERVICE_AUTH_TOKEN missing');
      return false;
    }

    const templateKey =
      args.role === 'poster'
        ? 'wa_customer_welcome'
        : args.role === 'helper' || args.role === 'tasker'
          ? 'wa_helper_welcome'
          : 'wa_signup_welcome';

    if (!messagingServiceCircuit.isCallAllowed()) {
      logger.warn('MessagingServiceClient.sendSignupWelcome skipped (circuit open)', {
        uid: args.uid,
        circuitState: messagingServiceCircuit.getState(),
      });
      return false;
    }

    try {
      const response = await axios.post(
        `${this.baseURL}/api/v1/internal/whatsapp/send`,
        {
          uid: args.uid,
          templateKey,
          category: 'marketing',
          templateBody: args.templateBody || { var_1: args.name || 'User' },
          ensureContact: true,
          contactName: args.name,
          contactEmail: args.email,
          idempotencyKey: `signup:${args.uid}`,
          sync: true,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Service-Auth': this.token,
            'X-Service-Name': 'user-service',
            'X-Delivery-Mode': 'sync',
          },
          timeout: 20000,
        }
      );
      messagingServiceCircuit.recordSuccess();
      return Boolean(response.data?.sent);
    } catch (error) {
      messagingServiceCircuit.recordFailure();
      const axiosError = error as AxiosError;
      logger.warn('MessagingServiceClient.sendSignupWelcome failed', {
        uid: args.uid,
        status: axiosError.response?.status,
        message: axiosError.message,
      });
      return false;
    }
  }
}
