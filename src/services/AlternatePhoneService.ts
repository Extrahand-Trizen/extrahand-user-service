import bcrypt from 'bcrypt';
import PhoneOTP from '../models/PhoneOTP';
import Profile from '../models/Profile';
import { Fast2SMSClient } from '../clients/Fast2SMSClient';
import { auth as firebaseAuth } from '../config/firebase';
import logger from '../config/logger';
import { BadRequestError } from '../errors/AppError';
import {
  findProfileByVerifiedAlternatePhone,
  getTenDigitPhone,
  isPhoneUsedGlobally,
  normalizePhoneToE164,
  profileHasVerifiedAlternate,
} from '../utils/phoneUtils';

const DUPLICATE_MESSAGE =
  'This mobile number is already linked to another account. Please use a different number.';

export class AlternatePhoneService {
  private static readonly OTP_LENGTH = 6;
  private static readonly OTP_EXPIRY_MINUTES = 5;
  private static readonly MAX_ATTEMPTS = 5;
  private static readonly SALT_ROUNDS = 10;
  private static readonly RESEND_COOLDOWN_MS = 30_000;

  private static isLocalTestEnabled(): boolean {
    return process.env.LOCAL_TEST === 'true' || process.env.LOCAL_TEST === '1';
  }

  private static generateOTP(): string {
    const min = Math.pow(10, this.OTP_LENGTH - 1);
    const max = Math.pow(10, this.OTP_LENGTH) - 1;
    return Math.floor(min + Math.random() * (max - min + 1)).toString();
  }

  private static async hashOTP(otp: string): Promise<string> {
    return bcrypt.hash(otp, this.SALT_ROUNDS);
  }

  private static async verifyOTPHash(otp: string, hashedOTP: string): Promise<boolean> {
    return bcrypt.compare(otp, hashedOTP);
  }

  private static async assertNotRecentlySent(uid: string, phone: string, purpose: 'alternate_add' | 'login') {
    const recent = await PhoneOTP.findOne({ uid, phone, purpose })
      .sort({ createdAt: -1 })
      .lean();

    if (recent?.createdAt) {
      const elapsed = Date.now() - new Date(recent.createdAt).getTime();
      if (elapsed < this.RESEND_COOLDOWN_MS) {
        const waitSeconds = Math.ceil((this.RESEND_COOLDOWN_MS - elapsed) / 1000);
        throw new BadRequestError(
          `Please wait ${waitSeconds} second${waitSeconds === 1 ? '' : 's'} before requesting a new code.`
        );
      }
    }
  }

  private static async createAndSendOtp(params: {
    uid: string;
    phone: string;
    purpose: 'alternate_add' | 'login';
  }): Promise<{ expiresInMinutes: number; devOtp?: string }> {
    const normalizedPhone = normalizePhoneToE164(params.phone);
    await this.assertNotRecentlySent(params.uid, normalizedPhone, params.purpose);

    await PhoneOTP.updateMany(
      { uid: params.uid, purpose: params.purpose, verified: false },
      { $set: { verified: true } }
    );

    const otp = this.generateOTP();
    const hashedOTP = await this.hashOTP(otp);
    const expiresAt = new Date(Date.now() + this.OTP_EXPIRY_MINUTES * 60 * 1000);

    await PhoneOTP.create({
      uid: params.uid,
      phone: normalizedPhone,
      purpose: params.purpose,
      otp: hashedOTP,
      expiresAt,
      verified: false,
      attempts: 0,
    });

    const message = `Your ExtraHand verification code is ${otp}. Valid for ${this.OTP_EXPIRY_MINUTES} minutes.`;
    const smsSent = await Fast2SMSClient.sendSMS(normalizedPhone, message);

    if (!smsSent && !this.isLocalTestEnabled()) {
      throw new BadRequestError('Failed to send verification code. Please try again.');
    }

    logger.info('Alternate phone OTP generated', {
      uid: params.uid,
      phone: normalizedPhone,
      purpose: params.purpose,
      smsSent,
      devOtp: this.isLocalTestEnabled() ? otp : undefined,
    });

    return {
      expiresInMinutes: this.OTP_EXPIRY_MINUTES,
      ...(this.isLocalTestEnabled() ? { devOtp: otp } : {}),
    };
  }

  static async sendAlternateAddOtp(uid: string, phone: string) {
    const normalizedPhone = normalizePhoneToE164(phone);
    const tenDigit = getTenDigitPhone(normalizedPhone);
    if (tenDigit.length !== 10 || !/^[6-9]\d{9}$/.test(tenDigit)) {
      throw new BadRequestError('Enter a valid 10-digit mobile number.');
    }

    const profile = await Profile.findOne({ uid }).lean();
    if (!profile) {
      throw new BadRequestError('Profile not found');
    }

    const primaryTen = getTenDigitPhone(profile.phone || '');
    if (primaryTen && primaryTen === tenDigit) {
      throw new BadRequestError('Alternate number cannot be the same as your primary number.');
    }

    const usage = await isPhoneUsedGlobally(normalizedPhone, uid);
    if (usage.used) {
      return {
        success: false,
        code: 'PHONE_ALREADY_LINKED',
        message: DUPLICATE_MESSAGE,
      };
    }

    const result = await this.createAndSendOtp({
      uid,
      phone: normalizedPhone,
      purpose: 'alternate_add',
    });

    return {
      success: true,
      phone: normalizedPhone,
      expiresInMinutes: result.expiresInMinutes,
      ...(result.devOtp ? { devOtp: result.devOtp } : {}),
    };
  }

  static async verifyAndSaveAlternate(uid: string, phone: string, otp: string) {
    const normalizedPhone = normalizePhoneToE164(phone);
    const usage = await isPhoneUsedGlobally(normalizedPhone, uid);
    if (usage.used) {
      return {
        success: false,
        code: 'PHONE_ALREADY_LINKED',
        message: DUPLICATE_MESSAGE,
      };
    }

    const otpRecord = await PhoneOTP.findOne({
      uid,
      phone: normalizedPhone,
      purpose: 'alternate_add',
      verified: false,
      expiresAt: { $gt: new Date() },
    }).sort({ createdAt: -1 });

    if (!otpRecord) {
      throw new BadRequestError('Verification code expired. Please request a new code.');
    }

    if (otpRecord.attempts >= this.MAX_ATTEMPTS) {
      throw new BadRequestError('Too many failed attempts. Please request a new code.');
    }

    const isValid = await this.verifyOTPHash(String(otp).trim(), otpRecord.otp);
    if (!isValid) {
      otpRecord.attempts += 1;
      await otpRecord.save();
      throw new BadRequestError('Invalid verification code.');
    }

    otpRecord.verified = true;
    await otpRecord.save();

    try {
      const updated = await Profile.findOneAndUpdate(
        { uid },
        {
          $set: {
            alternatePhone: normalizedPhone,
            alternatePhoneVerified: true,
            alternatePhoneVerifiedAt: new Date(),
          },
        },
        { new: true, runValidators: true }
      ).lean();

      if (!updated) {
        throw new BadRequestError('Profile not found');
      }

      return { success: true, data: updated };
    } catch (error: any) {
      if (error.code === 11000) {
        return {
          success: false,
          code: 'PHONE_ALREADY_LINKED',
          message: DUPLICATE_MESSAGE,
        };
      }
      throw error;
    }
  }

  static async removeAlternate(uid: string) {
    const updated = await Profile.findOneAndUpdate(
      { uid },
      {
        $unset: {
          alternatePhone: '',
          alternatePhoneVerifiedAt: '',
        },
        $set: {
          alternatePhoneVerified: false,
        },
      },
      { new: true }
    ).lean();

    if (!updated) {
      throw new BadRequestError('Profile not found');
    }

    return { success: true, data: updated };
  }

  static async sendAlternateLoginOtp(phone: string) {
    const normalizedPhone = normalizePhoneToE164(phone);
    const profile = await findProfileByVerifiedAlternatePhone(normalizedPhone);

    if (!profile) {
      throw new BadRequestError('No account found for this mobile number.');
    }

    const result = await this.createAndSendOtp({
      uid: profile.uid,
      phone: normalizedPhone,
      purpose: 'login',
    });

    return {
      success: true,
      phone: normalizedPhone,
      expiresInMinutes: result.expiresInMinutes,
      ...(result.devOtp ? { devOtp: result.devOtp } : {}),
    };
  }

  static async verifyAlternateLoginOtp(phone: string, otp: string) {
    const normalizedPhone = normalizePhoneToE164(phone);
    const profile = await findProfileByVerifiedAlternatePhone(normalizedPhone);

    if (!profile) {
      throw new BadRequestError('No account found for this mobile number.');
    }

    const otpRecord = await PhoneOTP.findOne({
      uid: profile.uid,
      phone: normalizedPhone,
      purpose: 'login',
      verified: false,
      expiresAt: { $gt: new Date() },
    }).sort({ createdAt: -1 });

    if (!otpRecord) {
      throw new BadRequestError('Verification code expired. Please request a new code.');
    }

    if (otpRecord.attempts >= this.MAX_ATTEMPTS) {
      throw new BadRequestError('Too many failed attempts. Please request a new code.');
    }

    const isValid = await this.verifyOTPHash(String(otp).trim(), otpRecord.otp);
    if (!isValid) {
      otpRecord.attempts += 1;
      await otpRecord.save();
      throw new BadRequestError('Invalid verification code.');
    }

    otpRecord.verified = true;
    await otpRecord.save();

    const customToken = await firebaseAuth.createCustomToken(profile.uid);

    return {
      success: true,
      customToken,
      profile,
      loginViaAlternate: true,
    };
  }

  static async assertVerifiedAlternateLogin(uid: string, phone: string): Promise<boolean> {
    const profile = await Profile.findOne({ uid }).lean();
    if (!profile) return false;
    return profileHasVerifiedAlternate(profile, phone);
  }

  private static assertFirebasePhoneMatchesToken(expectedPhone: string, decoded: { phone_number?: string }) {
    const expected = getTenDigitPhone(expectedPhone);
    const tokenPhone = getTenDigitPhone(decoded.phone_number || '');
    if (!expected || expected.length !== 10 || tokenPhone !== expected) {
      throw new BadRequestError('Phone number verification failed. Please try again.');
    }
  }

  /**
   * Save alternate phone after Firebase OTP verification on the client.
   * originalIdToken identifies the account; alternateIdToken proves OTP for the new number.
   */
  static async verifyAndSaveAlternateFirebase(
    originalIdToken: string,
    phone: string,
    alternateIdToken: string
  ) {
    const normalizedPhone = normalizePhoneToE164(phone);
    const tenDigit = getTenDigitPhone(normalizedPhone);
    if (tenDigit.length !== 10 || !/^[6-9]\d{9}$/.test(tenDigit)) {
      throw new BadRequestError('Enter a valid 10-digit mobile number.');
    }

    let originalDecoded;
    let alternateDecoded;
    try {
      originalDecoded = await firebaseAuth.verifyIdToken(originalIdToken);
      alternateDecoded = await firebaseAuth.verifyIdToken(alternateIdToken);
    } catch {
      throw new BadRequestError('Invalid or expired verification. Please try again.');
    }

    const uid = originalDecoded.uid;
    this.assertFirebasePhoneMatchesToken(normalizedPhone, alternateDecoded);

    const profile = await Profile.findOne({ uid }).lean();
    if (!profile) {
      throw new BadRequestError('Profile not found');
    }

    const primaryTen = getTenDigitPhone(profile.phone || '');
    if (primaryTen && primaryTen === tenDigit) {
      throw new BadRequestError('Alternate number cannot be the same as your primary number.');
    }

    const usage = await isPhoneUsedGlobally(normalizedPhone, uid);
    if (usage.used) {
      return {
        success: false,
        code: 'PHONE_ALREADY_LINKED',
        message: DUPLICATE_MESSAGE,
      };
    }

    try {
      const updated = await Profile.findOneAndUpdate(
        { uid },
        {
          $set: {
            alternatePhone: normalizedPhone,
            alternatePhoneVerified: true,
            alternatePhoneVerifiedAt: new Date(),
          },
        },
        { new: true, runValidators: true }
      ).lean();

      if (!updated) {
        throw new BadRequestError('Profile not found');
      }

      const customToken = await firebaseAuth.createCustomToken(uid);

      return {
        success: true,
        customToken,
        data: updated,
      };
    } catch (error: any) {
      if (error.code === 11000) {
        return {
          success: false,
          code: 'PHONE_ALREADY_LINKED',
          message: DUPLICATE_MESSAGE,
        };
      }
      throw error;
    }
  }

  static async completeAlternateLoginFirebase(phone: string, alternateIdToken: string) {
    const normalizedPhone = normalizePhoneToE164(phone);
    const profile = await findProfileByVerifiedAlternatePhone(normalizedPhone);

    if (!profile) {
      throw new BadRequestError('No account found for this mobile number.');
    }

    let alternateDecoded;
    try {
      alternateDecoded = await firebaseAuth.verifyIdToken(alternateIdToken);
    } catch {
      throw new BadRequestError('Invalid or expired verification. Please try again.');
    }

    this.assertFirebasePhoneMatchesToken(normalizedPhone, alternateDecoded);

    const customToken = await firebaseAuth.createCustomToken(profile.uid);

    return {
      success: true,
      customToken,
      profile,
      loginViaAlternate: true,
    };
  }

  /** Restore Firebase session after temporary alternate-number OTP verification. */
  static async restoreFirebaseSession(idToken: string) {
    let decoded;
    try {
      decoded = await firebaseAuth.verifyIdToken(idToken);
    } catch {
      throw new BadRequestError('Invalid or expired session. Please log in again.');
    }

    const customToken = await firebaseAuth.createCustomToken(decoded.uid);
    return { success: true, customToken };
  }
}
