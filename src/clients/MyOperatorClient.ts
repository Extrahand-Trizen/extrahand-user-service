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
    const contactId =
      data?.id ??
      data?.contact_id ??
      data?.contactId ??
      data?.contact?.id ??
      null;

    logger.info('MyOperator contact create request succeeded', {
      status: response.status,
      contactId,
      responseData: data,
    });

    return { contactId, raw: data };
  }
}

