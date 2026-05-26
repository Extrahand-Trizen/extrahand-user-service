import axios from 'axios';
import logger from '../config/logger';

export type MyOperatorCreateContactParams = {
  name: string;
  countryCode: string; // e.g. "91"
  phoneNumber: string; // without country code, e.g. last 10 digits
  emailId: string;
  marketingOptIn: boolean;
};

export type MyOperatorCreateContactResult = {
  contactId?: string | null;
  raw?: any;
};

export type MyOperatorSendWaTemplateParams = {
  customerCountryCode: string;
  /** National number without country code (e.g. last 10 digits for India). */
  customerNumber: string;
  templateName: string;
  language?: string;
  /** Optional template body variables, e.g. { name: "Gowri" }. */
  templateBody?: Record<string, string>;
};

/** Normalize API id values (numbers, ObjectIds as objects) to a string for MongoDB. */
function coerceContactId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const t = value.trim();
    return t.length ? t : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'object' && value !== null && '$oid' in (value as object)) {
    const oid = (value as { $oid?: string }).$oid;
    return typeof oid === 'string' && oid.trim() ? oid.trim() : null;
  }
  return null;
}

/**
 * MyOperator often wraps payloads as { status: "success", data: [ { ... } ] }.
 * The public contacts API may also return ids under alternate keys; collect
 * every reasonable shape so we can persist myOperatorContactId.
 */
function extractContactIdFromResponse(data: any): string | null {
  if (data == null) return null;

  const fromObject = (obj: any): string | null => {
    if (!obj || typeof obj !== 'object') return null;
    return (
      coerceContactId(obj.id) ??
      coerceContactId(obj.contact_id) ??
      coerceContactId(obj.contactId) ??
      coerceContactId(obj.uuid) ??
      coerceContactId(obj.unique_id) ??
      coerceContactId(obj._id) ??
      coerceContactId(obj?.contact?.id) ??
      coerceContactId(obj?.contact?.contact_id) ??
      null
    );
  };

  let id = fromObject(data);
  if (id) return id;

  const singleNested = data.data ?? data.result ?? data.response ?? data.contact ?? data.payload;
  if (Array.isArray(singleNested)) {
    for (const item of singleNested) {
      id = fromObject(item);
      if (id) return id;
    }
  } else if (singleNested && typeof singleNested === 'object') {
    id = fromObject(singleNested);
    if (id) return id;
    for (const key of ['contacts', 'records', 'items', 'results', 'data']) {
      const arr = (singleNested as any)[key];
      if (Array.isArray(arr)) {
        for (const item of arr) {
          id = fromObject(item);
          if (id) return id;
        }
      }
    }
  }

  return null;
}

/**
 * Client for MyOperator contact creation.
 * Endpoint: POST https://publicapi.myoperator.co/contacts
 *
 * Notes:
 * - This is an optional integration: if env vars are missing, signup proceeds without failing.
 * - We keep it isolated so it doesn't impact other signup/login/profile behavior.
 */
export class MyOperatorClient {
  static async createContact(
    params: MyOperatorCreateContactParams
  ): Promise<MyOperatorCreateContactResult | null> {
    const bearerToken = process.env.MYOPERATOR_BEARER_TOKEN;
    const companyId = process.env.MYOPERATOR_COMPANY_ID;

    if (!bearerToken || !companyId) {
      logger.warn('MyOperator contact creation skipped (missing env vars)', {
        hasBearerToken: !!bearerToken,
        hasCompanyId: !!companyId,
      });
      return null;
    }

    const contactsUrl =
      process.env.MYOPERATOR_CONTACTS_URL ||
      'https://publicapi.myoperator.co/contacts';

    const payload = {
      name: params.name,
      country_code: params.countryCode,
      phone_number: params.phoneNumber,
      email_id: params.emailId,
      marketing_opt_in: params.marketingOptIn,
    };

    const headers = {
      Authorization: `Bearer ${bearerToken}`,
      'X-MYOP-COMPANY-ID': companyId,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };

    logger.info('MyOperator contact create request started', {
      contactsUrl,
      companyId,
      payload: {
        name: payload.name,
        country_code: payload.country_code,
        phone_number: payload.phone_number,
        email_id: payload.email_id,
        marketing_opt_in: payload.marketing_opt_in,
      },
    });

    const response = await axios.post(contactsUrl, payload, {
      headers,
      timeout: 8000,
    });

    const data = response.data;
    const contactId = extractContactIdFromResponse(data);

    if (!contactId) {
      logger.warn('MyOperator contact create returned no parseable contact id', {
        status: response.status,
        topLevelKeys: data && typeof data === 'object' ? Object.keys(data) : [],
        responseData: data,
      });
    } else {
      logger.info('MyOperator contact create request succeeded', {
        status: response.status,
        contactId,
        responseData: data,
      });
    }

    return { contactId, raw: data };
  }

  /**
   * POST /chat/messages — send a WhatsApp template (MyOperator public API).
   * Same auth headers as contacts. Skips quietly when required env is missing.
   */
  static async sendWhatsAppTemplate(
    params: MyOperatorSendWaTemplateParams
  ): Promise<boolean> {
    const bearerToken = process.env.MYOPERATOR_BEARER_TOKEN;
    const companyId = process.env.MYOPERATOR_COMPANY_ID;
    const phoneNumberId = process.env.MYOPERATOR_WHATSAPP_PHONE_NUMBER_ID;
    const messagesUrl =
      process.env.MYOPERATOR_CHAT_MESSAGES_URL ||
      'https://publicapi.myoperator.co/chat/messages';

    if (!bearerToken || !companyId || !phoneNumberId) {
      logger.warn('MyOperator WhatsApp template skipped (missing env vars)', {
        hasBearerToken: !!bearerToken,
        hasCompanyId: !!companyId,
        hasPhoneNumberId: !!phoneNumberId,
      });
      console.warn(
        '[MyOperator][WhatsApp] Template NOT sent: missing env (MYOPERATOR_BEARER_TOKEN / MYOPERATOR_COMPANY_ID / MYOPERATOR_WHATSAPP_PHONE_NUMBER_ID)'
      );
      return false;
    }

    const digits = String(params.customerNumber || '').replace(/\D/g, '');
    const national = digits.length >= 10 ? digits.slice(-10) : digits;
    if (national.length < 10) {
      logger.warn('MyOperator WhatsApp template skipped (invalid customer number)', {
        nationalLength: national.length,
      });
      console.warn(
        '[MyOperator][WhatsApp] Template NOT sent: invalid customer_number (need 10 digits)',
        { nationalLength: national.length }
      );
      return false;
    }

    const countryCode = String(params.customerCountryCode || '91').replace(/^\+/, '');
    const language =
      params.language ||
      process.env.MYOPERATOR_SIGNUP_WA_LANGUAGE ||
      'en';

    const body = {
      phone_number_id: String(phoneNumberId),
      customer_country_code: countryCode,
      customer_number: national,
      data: {
        type: 'template',
        context: {
          template_name: params.templateName,
          language,
          ...(params.templateBody && Object.keys(params.templateBody).length > 0
            ? { body: params.templateBody }
            : {}),
        },
      },
      reply_to: null,
      myop_ref_id: null,
      trail: { name: null },
    };

    const headers = {
      Authorization: `Bearer ${bearerToken}`,
      'X-MYOP-COMPANY-ID': companyId,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };

    logger.info('MyOperator WhatsApp template request started', {
      messagesUrl,
      templateName: params.templateName,
      customerCountryCode: countryCode,
      customerNumberTail: national.slice(-4),
    });

    try {
      const response = await axios.post(messagesUrl, body, {
        headers,
        timeout: 12000,
      });
      logger.info('MyOperator WhatsApp template request succeeded', {
        status: response.status,
        templateName: params.templateName,
      });
      console.log('[MyOperator][WhatsApp] Template sent OK', {
        templateName: params.templateName,
        status: response.status,
        customerNumberTail: national.slice(-4),
      });
      return true;
    } catch (error: any) {
      const status = error?.response?.status;
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('MyOperator WhatsApp template request failed', {
        templateName: params.templateName,
        message,
        status,
        responseData: error?.response?.data,
      });
      console.warn('[MyOperator][WhatsApp] Template NOT sent (API error)', {
        templateName: params.templateName,
        status,
        message,
        responseData: error?.response?.data,
      });
      return false;
    }
  }

  /** Welcome template on signup; template name overridable via MYOPERATOR_SIGNUP_WA_TEMPLATE_NAME. */
  static async sendSignupWelcomeWhatsAppTemplate(params: {
    customerCountryCode: string;
    customerNumber: string;
    templateBody?: Record<string, string>;
  }): Promise<boolean> {
    const templateName =
      process.env.MYOPERATOR_SIGNUP_WA_TEMPLATE_NAME ||
      'copy_copy_extrahand_existing_taskerdata_campaign';
    const language = process.env.MYOPERATOR_SIGNUP_WA_LANGUAGE || 'en';
    return MyOperatorClient.sendWhatsAppTemplate({
      customerCountryCode: params.customerCountryCode,
      customerNumber: params.customerNumber,
      templateName,
      language,
      templateBody: params.templateBody,
    });
  }
}

