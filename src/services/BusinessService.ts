import Profile from '../models/Profile';
import { NotFoundError, BadRequestError } from '../errors/AppError';
import logger from '../config/logger';
import axios from 'axios';

function maskBankAccountNumber(accountNumber: string): string {
  const normalized = (accountNumber || '').trim();
  if (!normalized) return normalized;
  if (normalized.length <= 4) return normalized;
  return `XXXX${normalized.slice(-4)}`;
}

export class BusinessService {
  /**
   * Save business details
   */
  static async saveBusinessDetails(uid: string, businessData: any): Promise<void> {
    const profile = await Profile.findOne({ uid });
    if (!profile) {
      throw new NotFoundError('Profile not found');
    }

    if (profile.userType !== 'business') {
      throw new BadRequestError('User is not a business poster');
    }

    const normalizedBusinessData = { ...(businessData || {}) };
    if (normalizedBusinessData.bankAccount && typeof normalizedBusinessData.bankAccount === 'object') {
      const normalizedBankAccount = { ...normalizedBusinessData.bankAccount };
      if (typeof normalizedBankAccount.accountNumber === 'string') {
        normalizedBankAccount.accountNumber = maskBankAccountNumber(normalizedBankAccount.accountNumber);
      }
      if (typeof normalizedBankAccount.ifsc === 'string') {
        normalizedBankAccount.ifsc = normalizedBankAccount.ifsc.toUpperCase().trim();
      }
      normalizedBusinessData.bankAccount = normalizedBankAccount;
    }

    await Profile.updateOne(
      { uid },
      {
        $set: {
          business: {
            ...(profile.business || {}),
            ...normalizedBusinessData,
            updatedAt: new Date()
          },
          updatedAt: new Date()
        }
      }
    );

    logger.info('Business details saved', { uid });
  }

  /**
   * Verify business PAN
   */
  static async verifyBusinessPAN(
    uid: string,
    panNumber: string,
    consent: any,
    verificationServiceUrl: string,
    serviceAuthToken: string
  ): Promise<any> {
    // Validate PAN format
    const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
    if (!panRegex.test(panNumber.toUpperCase())) {
      throw new BadRequestError('Invalid PAN number format');
    }

    logger.info('Verifying business PAN', { uid, panNumber: panNumber.substring(0, 3) + 'XXXXX' });

    // Call verification service
    try {
      const response = await axios.post(
        `${verificationServiceUrl}/api/v1/verification/pan/verify`,
        {
          userId: uid,
          panNumber: panNumber.toUpperCase(),
          consent: consent || {
            given: true,
            timestamp: new Date().toISOString(),
            purpose: 'business_verification'
          }
        },
        {
          headers: {
            'X-Service-Auth': serviceAuthToken,
            'X-User-Id': uid,
            'X-Service-Name': 'extrahand-user-service'
          }
        }
      );

      if (response.data.success) {
        await Profile.updateOne(
          { uid },
          {
            $set: {
              // ❌ SECURITY: DO NOT STORE RAW PAN NUMBER
              // 'business.pan.number': panNumber.toUpperCase(),
              'business.pan.maskedPAN': response.data.data?.maskedPan || `${panNumber.slice(0, 3)}XXXXXX${panNumber.slice(-1)}`,
              'business.pan.isPANVerified': true,
              'business.pan.panVerifiedAt': new Date(),
              'business.pan.panVerificationRef': response.data.data?.referenceId || response.data.data?.refId,
              'business.verificationStatus.requirements.pan': true,
              maskedPan: response.data.data?.maskedPan || `${panNumber.slice(0, 3)}XXXXXX${panNumber.slice(-1)}`,
              updatedAt: new Date()
            }
          }
        );

        await this.updateBusinessTrustLevel(uid);
        await this.updatePosterVerificationStatus(uid);

        logger.info('Business PAN verified', { uid });
      }

      return response.data;
    } catch (error: any) {
      logger.error('Error verifying business PAN:', error);
      throw new BadRequestError(error.response?.data?.message || 'Failed to verify business PAN');
    }
  }

  /**
   * Verify business bank account
   */
  static async verifyBusinessBank(
    uid: string,
    accountNumber: string,
    ifsc: string,
    accountHolderName: string,
    consent: any,
    verificationServiceUrl: string,
    serviceAuthToken: string
  ): Promise<any> {
    if (!accountNumber || !ifsc || !accountHolderName) {
      throw new BadRequestError('Account number, IFSC, and account holder name are required');
    }

    const normalizedAccountNumber = accountNumber.trim();
    const maskedAccountNumber = maskBankAccountNumber(normalizedAccountNumber);
    const normalizedIfsc = ifsc.toUpperCase().trim();

    logger.info('Verifying business bank account', { uid });

    try {
      const response = await axios.post(
        `${verificationServiceUrl}/api/v1/verification/bank/verify`,
        {
          userId: uid,
          accountNumber: normalizedAccountNumber,
          ifsc: normalizedIfsc,
          accountHolderName,
          consent: consent || {
            given: true,
            timestamp: new Date().toISOString(),
            purpose: 'business_verification'
          }
        },
        {
          headers: {
            'X-Service-Auth': serviceAuthToken,
            'X-User-Id': uid,
            'X-Service-Name': 'extrahand-user-service'
          }
        }
      );

      if (response.data.success) {
        await Profile.updateOne(
          { uid },
          {
            $set: {
              // Store masked account number only (industry standard).
              'business.bankAccount.accountNumber': maskedAccountNumber,
              'business.bankAccount.accountHolderName': accountHolderName,
              // IFSC should remain fully visible.
              'business.bankAccount.ifsc': normalizedIfsc,
              'business.bankAccount.bankName': response.data.data?.bankName || 'Unknown',
              'business.bankAccount.isVerified': true,
              'business.bankAccount.verifiedAt': new Date(),
              'business.bankAccount.verificationRef': response.data.data?.referenceId || response.data.data?.refId,
              'business.verificationStatus.requirements.bank': true,
              updatedAt: new Date()
            }
          }
        );

        await this.updateBusinessTrustLevel(uid);
        await this.updatePosterVerificationStatus(uid);

        logger.info('Business bank account verified', { uid });
      }

      return response.data;
    } catch (error: any) {
      logger.error('Error verifying business bank:', error);
      throw new BadRequestError(error.response?.data?.message || 'Failed to verify business bank account');
    }
  }

  /**
   * Verify GST number
   */
  static async verifyGST(uid: string, gstNumber: string): Promise<any> {
    if (!gstNumber) {
      throw new BadRequestError('GST number is required');
    }

    // Validate GST format
    const gstRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
    if (!gstRegex.test(gstNumber.toUpperCase())) {
      throw new BadRequestError('Invalid GST number format');
    }

    logger.info('Verifying business GST (format validation only)', { uid });

    // For now, just validate format and mark as verified
    // TODO: Integrate with GST API (Karza or similar) for real verification
    await Profile.updateOne(
      { uid },
      {
        $set: {
          'business.gstNumber': gstNumber.toUpperCase(),
          'business.isGSTVerified': true,
          'business.gstVerifiedAt': new Date(),
          'business.gstVerificationRef': `format_validated_${Date.now()}`,
          'business.verificationStatus.requirements.gst': true,
          updatedAt: new Date()
        }
      }
    );

    await this.updateBusinessTrustLevel(uid);

    logger.info('Business GST verified (format)', { uid });

    return {
      success: true,
      message: 'GST number format validated successfully',
      data: {
        gstNumber: gstNumber.toUpperCase(),
        isVerified: true,
        note: 'Format validation only. Real GST API integration pending.'
      }
    };
  }

  /**
   * Upload business document
   */
  static async uploadBusinessDocument(uid: string, documentType: string, documentUrl: string): Promise<void> {
    if (!documentType || !documentUrl) {
      throw new BadRequestError('Document type and URL are required');
    }

    const profile = await Profile.findOne({ uid });
    if (!profile) {
      throw new NotFoundError('Profile not found');
    }

    const documents = profile.business?.documents || [];
    documents.push({
      type: documentType,
      url: documentUrl,
      uploadedAt: new Date(),
      verified: false
    });

    await Profile.updateOne(
      { uid },
      {
        $set: {
          'business.documents': documents,
          updatedAt: new Date()
        }
      }
    );

    logger.info('Business document uploaded', { uid, documentType });
  }

  /**
   * Get business verification status
   */
  static async getBusinessStatus(uid: string): Promise<any> {
    const profile = await Profile.findOne({ uid }).lean();
    if (!profile) {
      throw new NotFoundError('Profile not found');
    }

    if (profile.userType !== 'business') {
      throw new BadRequestError('User is not a business poster');
    }

    return {
      business: profile.business || null,
      verificationStatus: profile.business?.verificationStatus || null,
      canPostTasks: profile.roleVerifications?.poster?.canPostTasks || false
    };
  }

  /**
   * Update business trust level
   */
  private static async updateBusinessTrustLevel(uid: string): Promise<void> {
    try {
      const profile = await Profile.findOne({ uid }).lean();
      if (!profile?.business) return;

      const { pan, bankAccount, gstNumber, authorizedSignatory, documents } = profile.business;

      let level = 0;
      let badge: 'basic' | 'verified' | 'trusted' | 'enterprise' = 'basic';

      // Level 3: Enterprise (All verified + Documents)
      if (pan?.isPANVerified && bankAccount?.isVerified &&
          gstNumber && profile.business.isGSTVerified && authorizedSignatory?.isAadhaarVerified &&
          documents && documents.length > 0) {
        level = 3;
        badge = 'enterprise';
      }
      // Level 2: Trusted (PAN + Bank + GST + Aadhaar)
      else if (pan?.isPANVerified && bankAccount?.isVerified &&
               gstNumber && profile.business.isGSTVerified && authorizedSignatory?.isAadhaarVerified) {
        level = 2;
        badge = 'trusted';
      }
      // Level 1: Verified (PAN + Bank)
      else if (pan?.isPANVerified && bankAccount?.isVerified) {
        level = 1;
        badge = 'verified';
      }

      await Profile.updateOne(
        { uid },
        {
          $set: {
            'business.verificationStatus.level': level,
            'business.verificationStatus.badge': badge,
            'business.verificationStatus.verifiedAt': new Date(),
            updatedAt: new Date()
          }
        }
      );

      logger.info('Business trust level updated', { uid, level, badge });
    } catch (error) {
      logger.error('Error updating business trust level:', error);
    }
  }

  /**
   * Update poster verification status
   */
  private static async updatePosterVerificationStatus(uid: string): Promise<void> {
    try {
      const profile = await Profile.findOne({ uid }).lean();
      if (!profile || profile.userType !== 'business') return;

      const canPostTasks = profile.business?.pan?.isPANVerified &&
                           profile.business?.bankAccount?.isVerified;

      await Profile.updateOne(
        { uid },
        {
          $set: {
            'roleVerifications.poster.canPostTasks': canPostTasks,
            'roleVerifications.poster.requirements.businessPAN': profile.business?.pan?.isPANVerified || false,
            'roleVerifications.poster.requirements.businessBank': profile.business?.bankAccount?.isVerified || false,
            'roleVerifications.poster.verifiedAt': canPostTasks ? new Date() : profile.roleVerifications?.poster?.verifiedAt,
            updatedAt: new Date()
          }
        }
      );

      logger.info('Poster verification status updated', { uid, canPostTasks });
    } catch (error) {
      logger.error('Error updating poster verification status:', error);
    }
  }
}


