import bcrypt from 'bcrypt';
import EmailOTP from '../models/EmailOTP';
import Profile from '../models/Profile';
import { EmailServiceClient } from '../clients/EmailServiceClient';
import logger from '../config/logger';
import { ProfileService } from './ProfileService';

export class EmailVerificationService {
    private static readonly OTP_LENGTH = 6;
    private static readonly OTP_EXPIRY_MINUTES = 5;
    private static readonly MAX_ATTEMPTS = 5;
    private static readonly SALT_ROUNDS = 10;

    private static normalizeEmail(email: string): string {
        return email.trim().toLowerCase();
    }

    private static async findOtherVerifiedProfileByEmail(uid: string, email: string) {
        return Profile.findOne({
            uid: { $ne: uid },
            email,
            isEmailVerified: true,
            isActive: true
        })
            .select('uid email')
            .lean();
    }

    /**
     * Generate a random 6-digit OTP
     */
    private static generateOTP(): string {
        const min = Math.pow(10, this.OTP_LENGTH - 1);
        const max = Math.pow(10, this.OTP_LENGTH) - 1;
        const otp = Math.floor(min + Math.random() * (max - min + 1)).toString();
        return otp;
    }

    /**
     * Hash OTP using bcrypt for secure storage
     */
    private static async hashOTP(otp: string): Promise<string> {
        return bcrypt.hash(otp, this.SALT_ROUNDS);
    }

    /**
     * Verify OTP against hashed value
     */
    private static async verifyOTPHash(otp: string, hashedOTP: string): Promise<boolean> {
        return bcrypt.compare(otp, hashedOTP);
    }

    /**
     * Initiate email verification by generating and sending OTP
     */
    static async initiateEmailVerification(
        uid: string,
        email: string,
        name?: string
    ): Promise<{
        success: boolean;
        code?: string;
        verificationId?: string;
        expiresInMinutes?: number;
        message?: string;
    }> {
        try {
            const normalizedEmail = this.normalizeEmail(email);
            const currentProfile = await ProfileService.getProfileByUid(uid);

            if (
                currentProfile.isEmailVerified &&
                this.normalizeEmail(currentProfile.email || '') === normalizedEmail
            ) {
                return {
                    success: false,
                    code: 'email_already_verified',
                    message: 'This email is already verified on your account.'
                };
            }

            const existingVerifiedProfile = await this.findOtherVerifiedProfileByEmail(uid, normalizedEmail);
            if (existingVerifiedProfile) {
                logger.warn('Attempted to verify email already verified by another account', {
                    uid,
                    email: normalizedEmail,
                    existingUid: existingVerifiedProfile.uid
                });
                return {
                    success: false,
                    code: 'email_already_verified_elsewhere',
                    message: 'This email is already verified on another account. Please use a different email address.'
                };
            }

            // Invalidate any existing unverified OTPs for this user
            await EmailOTP.updateMany(
                { uid, verified: false },
                { $set: { verified: true } } // Mark as verified to prevent reuse
            );

            // Generate new OTP
            const otp = this.generateOTP();
            const hashedOTP = await this.hashOTP(otp);
            const expiresAt = new Date(Date.now() + this.OTP_EXPIRY_MINUTES * 60 * 1000);

            logger.info('Generated OTP for email verification', {
                uid,
                email: normalizedEmail,
                otp: otp, // IMPORTANT: Log the actual OTP for debugging
                expiresAt: expiresAt.toISOString()
            });

            // Store OTP in database
            const otpRecord = await EmailOTP.create({
                uid,
                email: normalizedEmail,
                otp: hashedOTP,
                expiresAt,
                verified: false,
                attempts: 0
            });

            logger.info('Email OTP generated and stored', {
                uid,
                email: normalizedEmail,
                verificationId: otpRecord._id.toString(),
                expiresAt,
                hashedOtpLength: hashedOTP.length
            });

            // Send OTP via email
            const emailSent = await EmailServiceClient.sendEmailVerification(
                normalizedEmail,
                otp,
                undefined, // No verification link
                name,
                expiresAt
            );

            if (!emailSent) {
                logger.error('Failed to send OTP email - EmailServiceClient returned false', {
                    uid,
                    email: normalizedEmail,
                    emailServiceURL: process.env.EMAIL_SERVICE_URL || 'http://localhost:4007',
                    hint: 'Check if email-service is running and SERVICE_AUTH_TOKEN matches'
                });
                return {
                    success: false,
                    message: 'Failed to send verification email. Please try again.',
                    code: 'email_send_failed'
                };
            }

            return {
                success: true,
                verificationId: otpRecord._id.toString(),
                expiresInMinutes: this.OTP_EXPIRY_MINUTES,
                message: 'Verification code sent to your email'
            };
        } catch (error: any) {
            logger.error('Error initiating email verification', {
                uid,
                email,
                error: error.message
            });
            return {
                success: false,
                message: 'Failed to initiate email verification'
            };
        }
    }

    /**
     * Verify OTP and update user profile on success
     */
    static async verifyEmailOTP(
        uid: string,
        otp: string,
        verificationId?: string
    ): Promise<{
        success: boolean;
        code?: string;
        message?: string;
    }> {
        try {
            logger.info('Starting OTP verification', {
                uid,
                verificationId,
                otpLength: otp?.length,
                hasVerificationId: !!verificationId
            });

            // Find the OTP record
            const query: any = {
                uid,
                verified: false,
                expiresAt: { $gt: new Date() }
            };

            if (verificationId) {
                query._id = verificationId;
            }

            logger.info('Searching for OTP record', {
                query,
                currentTime: new Date().toISOString()
            });

            const otpRecord = await EmailOTP.findOne(query).sort({ createdAt: -1 });

            logger.info('OTP record search result', {
                found: !!otpRecord,
                recordId: otpRecord?._id?.toString(),
                recordUid: otpRecord?.uid,
                recordEmail: otpRecord?.email,
                recordExpiry: otpRecord?.expiresAt?.toISOString(),
                recordVerified: otpRecord?.verified,
                recordAttempts: otpRecord?.attempts
            });

            if (!otpRecord) {
                // Check if there are ANY OTP records for this user
                const allRecords = await EmailOTP.find({ uid }).sort({ createdAt: -1 }).limit(5);
                logger.warn('No valid OTP found - checking all records', {
                    uid,
                    verificationId,
                    totalRecords: allRecords.length,
                    records: allRecords.map(r => ({
                        id: r._id.toString(),
                        email: r.email,
                        verified: r.verified,
                        expiresAt: r.expiresAt.toISOString(),
                        expired: r.expiresAt < new Date(),
                        attempts: r.attempts
                    }))
                });

                return {
                    success: false,
                    message: 'Invalid or expired verification code'
                };
            }

            // Check attempts
            if (otpRecord.attempts >= this.MAX_ATTEMPTS) {
                logger.warn('Max OTP attempts exceeded', { uid, attempts: otpRecord.attempts });
                return {
                    success: false,
                    message: 'Too many failed attempts. Please request a new code.'
                };
            }

            // Verify OTP
            logger.info('Verifying OTP hash', {
                uid,
                providedOtp: otp,
                storedHashLength: otpRecord.otp?.length
            });

            const isValid = await this.verifyOTPHash(otp, otpRecord.otp);

            logger.info('OTP hash verification result', {
                uid,
                isValid,
                attempts: otpRecord.attempts
            });

            if (!isValid) {
                // Increment attempts
                otpRecord.attempts += 1;
                await otpRecord.save();

                logger.warn('Invalid OTP entered', {
                    uid,
                    attempts: otpRecord.attempts,
                    maxAttempts: this.MAX_ATTEMPTS
                });

                return {
                    success: false,
                    message: `Invalid code. ${this.MAX_ATTEMPTS - otpRecord.attempts} attempts remaining.`
                };
            }

            // OTP is valid - mark as verified
            const existingVerifiedProfile = await this.findOtherVerifiedProfileByEmail(uid, otpRecord.email);
            if (existingVerifiedProfile) {
                logger.warn('Blocked email verification because email is already verified by another account', {
                    uid,
                    email: otpRecord.email,
                    existingUid: existingVerifiedProfile.uid,
                    verificationId: otpRecord._id.toString()
                });
                return {
                    success: false,
                    code: 'email_already_verified_elsewhere',
                    message: 'This email is already verified on another account. Please use a different email address.'
                };
            }

            otpRecord.verified = true;
            await otpRecord.save();

            // Update user profile
            await ProfileService.updateProfile(uid, {
                isEmailVerified: true,
                emailVerifiedAt: new Date(),
                email: otpRecord.email
            });

            logger.info('Email verification successful', {
                uid,
                email: otpRecord.email
            });

            // Send verification confirmation email
            try {
                const profile = await ProfileService.getProfileByUid(uid);
                if (profile) {
                    await EmailServiceClient.sendVerificationConfirmed(otpRecord.email, {
                        userName: profile.name || 'there',
                        verificationType: 'Email Address',
                        maskedValue: otpRecord.email,
                        verifiedDate: new Date().toLocaleDateString('en-IN', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric'
                        }),
                        nextSteps: 'Verify your phone number to enable two-factor authentication.',
                        userId: uid
                    });
                    logger.info('Verification confirmation email sent', {
                        uid,
                        email: otpRecord.email
                    });
                }
            } catch (emailError: any) {
                // Don't fail verification if email sending fails
                logger.error('Failed to send verification confirmation email', {
                    uid,
                    email: otpRecord.email,
                    error: emailError.message
                });
            }

            return {
                success: true,
                message: 'Email verified successfully'
            };
        } catch (error: any) {
            logger.error('Error verifying email OTP', {
                uid,
                error: error.message,
                stack: error.stack
            });
            return {
                success: false,
                message: 'Failed to verify email'
            };
        }
    }

    /**
     * Resend OTP to user's email
     */
    static async resendEmailOTP(
        uid: string
    ): Promise<{
        success: boolean;
        code?: string;
        verificationId?: string;
        expiresInMinutes?: number;
        message?: string;
    }> {
        try {
            // Find the most recent OTP record to get the email
            const lastOTP = await EmailOTP.findOne({ uid }).sort({ createdAt: -1 });

            if (!lastOTP) {
                logger.warn('No previous OTP found for resend', { uid });
                return {
                    success: false,
                    message: 'No previous verification request found'
                };
            }

            // Get user profile for name
            const profile = await ProfileService.getProfileByUid(uid);

            // Initiate new verification
            return this.initiateEmailVerification(uid, lastOTP.email, profile.name);
        } catch (error: any) {
            logger.error('Error resending email OTP', {
                uid,
                error: error.message
            });
            return {
                success: false,
                message: 'Failed to resend verification code'
            };
        }
    }

    /**
     * Get email verification status for a user
     */
    static async getVerificationStatus(uid: string): Promise<{
        success: boolean;
        data?: {
            isEmailVerified: boolean;
            emailVerifiedAt?: Date;
            email?: string;
        };
        message?: string;
    }> {
        try {
            const profile = await ProfileService.getProfileByUid(uid);

            return {
                success: true,
                data: {
                    isEmailVerified: profile.isEmailVerified || false,
                    emailVerifiedAt: profile.emailVerifiedAt || undefined,
                    email: profile.email || undefined
                }
            };
        } catch (error: any) {
            logger.error('Error getting email verification status', {
                uid,
                error: error.message
            });
            return {
                success: false,
                message: 'Failed to get verification status'
            };
        }
    }
}

export default EmailVerificationService;
