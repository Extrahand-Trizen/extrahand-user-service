import { auth } from '../config/firebase';
import Profile from '../models/Profile';
import { SignupRequest, LoginRequest, LoginResponse } from '../types';
import { BadRequestError, InternalServerError } from '../errors/AppError';
import logger from '../config/logger';

export class AuthService {
  /**
   * Create a new user account
   */
  static async signup(data: SignupRequest): Promise<{ uid: string; email: string | null; emailVerified: boolean; emailVerificationLink: string | null; message: string }> {
    const { email, password, displayName, phoneNumber } = data;

    // Email is optional - only validate if provided
    if (email && typeof email !== 'string') {
      throw new BadRequestError('Invalid email format');
    }

    // Password is required
    if (!password || typeof password !== 'string') {
      throw new BadRequestError('Password is required');
    }

    if (password.length < 6) {
      throw new BadRequestError('Password must be at least 6 characters');
    }

    // Use temporary email if not provided (for Firebase requirement)
    const signupEmail = email || `user_${Date.now()}@extrahand.temp`;

    try {
      const userRecord = await auth.createUser({
        email: signupEmail,
        password,
        displayName: displayName || null,
        phoneNumber: phoneNumber || null
      });

      // Create minimal profile in MongoDB
      const now = Date.now();
      await Profile.updateOne(
        { uid: userRecord.uid },
        {
          $set: {
            uid: userRecord.uid,
            name: displayName || 'User',
            email: email || null,
            emailVerified: false,
            roles: ['both'],
            userType: 'individual',
            location: null,
            skills: { list: [] },
            availability: null,
            phone: phoneNumber || null,
            photoURL: userRecord.photoURL || null,
            rating: 0,
            agreeUpdates: false,
            agreeTerms: false,
            updatedAt: now,
            createdAt: now,
          },
        },
        { upsert: true }
      );

      // Generate email verification link only if email was provided
      let emailVerificationLink: string | null = null;
      if (email) {
        try {
          emailVerificationLink = await auth.generateEmailVerificationLink(email);
        } catch (e) {
          logger.warn('Failed to generate email verification link:', e);
          emailVerificationLink = null;
        }
      }

      return {
        uid: userRecord.uid,
        email: email || null,
        emailVerified: false,
        emailVerificationLink,
        message: email
          ? 'Account created. Email verification link sent.'
          : 'Account created. You can add email later from Profile settings.'
      };
    } catch (error: any) {
      logger.error('Signup error:', error);
      throw new BadRequestError(error.message || 'Signup failed');
    }
  }

  /**
   * Login user with email and password
   */
  static async login(data: LoginRequest): Promise<LoginResponse> {
    const { email, password } = data;

    if (!email || !password) {
      throw new BadRequestError('email and password are required');
    }

    const emulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
    const apiKey = process.env.FIREBASE_WEB_API_KEY;
    const baseUrl = emulatorHost
      ? `http://localhost:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=any`
      : `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`;

    if (!emulatorHost && !apiKey) {
      throw new InternalServerError('Missing FIREBASE_WEB_API_KEY in server env');
    }

    try {
      const response = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true }),
      });

      const responseData = await response.json();

      if (!response.ok) {
        const message = responseData?.error?.message || 'Login failed';
        throw new BadRequestError(message);
      }

      return {
        idToken: responseData.idToken,
        refreshToken: responseData.refreshToken,
        expiresIn: responseData.expiresIn,
        localId: responseData.localId,
        email: responseData.email,
      };
    } catch (error: any) {
      if (error instanceof BadRequestError) {
        throw error;
      }
      logger.error('Login error:', error);
      throw new BadRequestError(error.message || 'Login failed');
    }
  }

  /**
   * Generate password reset link
   */
  static async generatePasswordResetLink(email: string, continueUrl?: string): Promise<string> {
    if (!email || typeof email !== 'string') {
      throw new BadRequestError('Invalid payload: email is required');
    }

    try {
      const actionCodeSettings = continueUrl ? { url: continueUrl } : undefined;
      const resetLink = await auth.generatePasswordResetLink(email, actionCodeSettings);
      return resetLink;
    } catch (error: any) {
      logger.error('Password reset error:', error);
      throw new BadRequestError(error.message || 'Could not generate reset link');
    }
  }

  /**
   * Check if phone number exists
   */
  static async checkPhoneExists(phone: string): Promise<{ exists: boolean; phone: string }> {
    if (!phone || typeof phone !== 'string') {
      throw new BadRequestError('Phone number is required');
    }

    // Clean phone number (remove spaces, ensure +91 prefix)
    const cleanPhone = phone.replace(/\D/g, '');
    const formattedPhone = cleanPhone.startsWith('91')
      ? `+${cleanPhone}`
      : `+91${cleanPhone}`;

    // ✨ Check if profile exists with this phone number
    // Try multiple formats to handle different storage formats
    // Extract just the 10-digit number (last 10 digits)
    const tenDigitNumber = cleanPhone.length >= 10 
      ? cleanPhone.slice(-10) // Get last 10 digits
      : cleanPhone;
    
    // Build comprehensive search query covering all possible formats
    const searchFormats = [
      formattedPhone, // +919121577021
      formattedPhone.replace('+91', '+91-'), // +91-9121577021
      cleanPhone, // 919121577021 (without +)
      `+${cleanPhone}`, // +919121577021 (alternative)
      cleanPhone.startsWith('91') ? cleanPhone : `91${cleanPhone}`, // 919121577021 or 91XXXXXXXXXX
      tenDigitNumber, // 9121577021 (10 digits only)
      `+91${tenDigitNumber}`, // +919121577021 (with 10-digit number)
      `91${tenDigitNumber}`, // 919121577021 (without +, with 10-digit)
    ];
    
    // Remove duplicates
    const uniqueFormats = [...new Set(searchFormats)];
    
    const searchQuery = {
      $or: uniqueFormats.map(format => ({ phone: format }))
    };

    logger.info('Checking phone existence', { 
      formattedPhone, 
      cleanPhone,
      tenDigitNumber,
      searchFormats: uniqueFormats,
      searchQuery: JSON.stringify(searchQuery)
    });

    // First try exact match with all formats
    let profile = await Profile.findOne(searchQuery).lean();
    
    // If not found, try aggregation pipeline to normalize and compare phone numbers
    if (!profile && tenDigitNumber.length === 10) {
      logger.info('Exact match not found, trying aggregation pipeline with normalized phone comparison');
      
      // Use aggregation to normalize phone numbers (remove all non-digits) and compare
      const normalizedProfiles = await Profile.aggregate([
        {
          $addFields: {
            normalizedPhone: {
              $replaceAll: {
                input: { $ifNull: ['$phone', ''] },
                find: /[^0-9]/g,
                replacement: ''
              }
            }
          }
        },
        {
          $match: {
            $or: [
              { normalizedPhone: cleanPhone },
              { normalizedPhone: `91${tenDigitNumber}` },
              { normalizedPhone: tenDigitNumber }
            ]
          }
        },
        { $limit: 1 }
      ]);
      
      if (normalizedProfiles.length > 0) {
        profile = normalizedProfiles[0];
        logger.info('Found profile using normalized phone comparison', {
          foundPhone: profile?.phone,
          normalizedPhone: normalizedProfiles[0]?.normalizedPhone
        });
      }
    }
    
    logger.info('Phone check result', { 
      exists: !!profile,
      foundPhone: profile?.phone,
      searchedPhone: formattedPhone,
      tenDigitNumber
    });

    return {
      exists: !!profile,
      phone: formattedPhone
    };
  }
}

