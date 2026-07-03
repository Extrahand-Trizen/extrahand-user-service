import axios, { AxiosError } from 'axios';
import logger from '../config/logger';
import { validateEnv } from '../config/env';

/**
 * EmailServiceClient
 * 
 * HTTP-based client for calling email-service APIs
 * Respects microservice boundaries - sends email requests to the email service
 * 
 * Usage:
 * EmailServiceClient.initialize();
 * await EmailServiceClient.sendWelcomeEmail(email, name);
 */
export class EmailServiceClient {
  private static baseURL: string = 'http://localhost:4007';
  private static serviceAuthToken: string = '';
  private static isInitialized: boolean = false;
  private static serviceName: string = 'user-service';

  /**
   * Initialize EmailServiceClient with required config
   * MUST be called once at app startup
   */
  static initialize(baseURL?: string): void {
    const env = validateEnv();
    this.baseURL = baseURL || process.env.EMAIL_SERVICE_URL || 'http://localhost:4007';
    this.serviceAuthToken = env.SERVICE_AUTH_TOKEN || '';
    this.isInitialized = true;

    logger.info('EmailServiceClient initialized', {
      baseURL: this.baseURL,
      hasAuthToken: !!this.serviceAuthToken
    });

    if (!this.serviceAuthToken) {
      logger.warn('EmailServiceClient initialized without SERVICE_AUTH_TOKEN', {
        consequence: 'Email requests will fail'
      });
    }
  }

  private static ensureInitialized(): void {
    if (!this.isInitialized) {
      logger.warn('EmailServiceClient: Not initialized, calling initialize with defaults');
      this.initialize();
    }
  }

  /**
   * Validate email address before sending
   * Prevents sending to placeholder/reserved addresses (RFC 2606)
   */
  private static isValidEmail(email: string): boolean {
    if (!email || typeof email !== 'string') return false;

    // Basic email format check
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return false;

    // Block RFC 2606 reserved domains (example.com, example.net, example.org, test, localhost, invalid)
    const reservedDomains = ['example.com', 'example.net', 'example.org', 'test', 'localhost', 'invalid'];
    const domain = email.split('@')[1]?.toLowerCase();
    if (reservedDomains.some(reserved => domain === reserved || domain?.endsWith(`.${reserved}`))) {
      logger.warn('EmailServiceClient: Skipping email to reserved/placeholder domain', { email, domain });
      return false;
    }

    return true;
  }

  private static async sendRequest(endpoint: string, data: any): Promise<boolean> {
    this.ensureInitialized();

    // Validate email address
    const email = data.email || data.to;
    if (!this.isValidEmail(email)) {
      logger.warn('EmailServiceClient: Skipping email - invalid or placeholder address', {
        email,
        endpoint
      });
      return false;
    }

    try {
      logger.info('EmailServiceClient: Sending email request', {
        endpoint,
        to: email,
        template: data.template,
        subject: data.subject,
        emailServiceURL: this.baseURL
      });

      const response = await axios.post(
        `${this.baseURL}/api/v1/email${endpoint}`,
        data,
        {
          headers: {
            'X-Service-Auth': this.serviceAuthToken,
            'X-Service-Name': this.serviceName,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      logger.info('EmailServiceClient: Email request successful', {
        endpoint,
        status: response.status,
        responseData: response.data
      });
      return true;
    } catch (error) {
      const axiosError = error as AxiosError;
      const errorDetails = {
        endpoint,
        to: email,
        template: data.template,
        subject: data.subject,
        status: axiosError.response?.status,
        statusText: axiosError.response?.statusText,
        responseData: axiosError.response?.data,
        message: axiosError.message,
        code: axiosError.code,
        emailServiceURL: this.baseURL,
        hasAuthToken: !!this.serviceAuthToken
      };
      logger.error('EmailServiceClient: Failed to send email', errorDetails);
      return false;
    }
  }

  // ============ Account & Auth Emails ============

  /**
   * Send welcome email to new user
   */
  static async sendWelcomeEmail(email: string, name: string): Promise<boolean> {
    const env = validateEnv();
    return this.sendRequest('/send', {
      to: email,
      subject: 'Welcome to ExtraHand!',
      template: 'welcome',
      data: {
        name,
        loginUrl: `${env.WEB_APP_URL || 'https://extrahand.in'}/login`,
        supportEmail: 'support@extrahand.in'
      }
    });
  }

  /**
   * Send email verification
   */
  static async sendEmailVerification(
    email: string,
    otp?: string,
    verificationLink?: string,
    name?: string,
    expiresAt?: Date
  ): Promise<boolean> {
    return this.sendRequest('/send', {
      to: email,
      subject: 'Verify Your Email Address - ExtraHand',
      template: 'email_verification',
      data: {
        name,
        otp,
        verificationLink,
        expiresAt: expiresAt?.toLocaleString()
      }
    });
  }

  /**
   * Send login alert for unusual login
   */
  static async sendLoginAlert(
    email: string,
    name: string,
    loginDetails: {
      device?: string;
      browser?: string;
      location?: string;
      ip?: string;
      loginTime?: string;
    },
    resetPasswordUrl?: string
  ): Promise<boolean> {
    return this.sendRequest('/send', {
      to: email,
      subject: '🔐 New Login Detected - ExtraHand',
      template: 'login_alert',
      data: {
        name,
        ...loginDetails,
        resetPasswordUrl,
        supportEmail: 'support@extrahand.in'
      }
    });
  }

  /**
   * Send account suspended notification
   */
  static async sendAccountSuspended(
    email: string,
    name: string,
    action: 'Suspended' | 'Disabled',
    reason?: string,
    appealUrl?: string
  ): Promise<boolean> {
    return this.sendRequest('/send', {
      to: email,
      subject: 'Your ExtraHand Account Has Been Suspended',
      template: 'account_suspended',
      data: {
        name,
        action,
        reason,
        appealUrl,
        supportEmail: 'support@extrahand.in'
      }
    });
  }

  /**
   * Send account created email (for bulk upload)
   */
  static async sendAccountCreated(email: string, name: string, phone?: string): Promise<boolean> {
    return this.sendRequest('/account-created', { email, name, phone });
  }

  /**
   * Send password reset email
   */
  static async sendPasswordReset(
    email: string,
    resetLink: string,
    name?: string,
    expiresAt?: Date
  ): Promise<boolean> {
    return this.sendRequest('/password-reset', {
      email,
      resetLink,
      name,
      expiresAt: expiresAt?.toISOString()
    });
  }

  /**
   * Send verification confirmed email
   * Used when user verifies Aadhaar, Phone, Email, PAN, or Bank Account
   */
  static async sendVerificationConfirmed(
    email: string,
    data: {
      userName: string;
      verificationType: 'Aadhaar' | 'Phone Number' | 'Email Address' | 'PAN Card' | 'Bank Account';
      maskedValue?: string;
      verifiedDate?: string;
      nextSteps?: string;
      userId?: string;
    }
  ): Promise<boolean> {
    const env = validateEnv();
    return this.sendRequest('/send', {
      to: email,
      template: 'verification_confirmed',
      data: {
        ...data,
        profileUrl: `${env.WEB_APP_URL || 'https://extrahand.in'}/profile`,
        platformName: 'ExtraHand'
      }
    });
  }
}
