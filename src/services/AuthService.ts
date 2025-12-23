import Profile from '../models/Profile';
import { BadRequestError } from '../errors/AppError';
import logger from '../config/logger';

export class AuthService {

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

