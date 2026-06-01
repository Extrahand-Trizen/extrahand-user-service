import { auth } from "../config/firebase";
import Profile from "../models/Profile";
import { BadRequestError, InternalServerError } from "../errors/AppError";
import logger from "../config/logger";
import { EmailServiceClient } from "../clients/EmailServiceClient";
import { MyOperatorClient } from "../clients/MyOperatorClient";
import NotificationPreferencesService from "./NotificationPreferencesService";
import {
   findActiveProfileByUidOrPhone,
   normalizePhoneToLast10,
   reconcileProfileUidByPhone,
   reactivateDeletedProfile,
} from "../utils/identityReconciliation";
import { ensureDemoVerificationProfile } from "../utils/reviewBypass";
import { ReferralRecord } from "../models/ReferralRecord";
import { ReferralService } from "./referralService";
import { ReferralApplyOrchestrator } from "../rewards/referral/ReferralApplyOrchestrator";
import { ReferralGrantReissue } from "../rewards/referral/ReferralGrantReissue";
import {
   logReferralCoins,
   referralCoinsPaymentConfig,
} from "../rewards/referral/referralCoinsLogger";

export class AuthService {
   private static readonly SIGNUP_WHATSAPP_DEFAULTS = {
      enabled: true,
      taskUpdates: true,
      payments: true,
      promotions: true,
      system: true,
      marketing: true,
      taskReminders: true,
      keywordTaskAlerts: true,
      recommendedTaskAlerts: true,
   };

   /**
    * Signup-only initialization:
    * ensure notification-preferences doc exists and has whatsapp defaults.
    * Does not alter existing non-whatsapp preferences.
    */
   private static async ensureSignupNotificationDefaults(uid: string): Promise<void> {
      try {
         const prefs = await NotificationPreferencesService.getPreferences(uid);
         const hasWhatsappEnabled =
            prefs &&
            (prefs as any).whatsapp &&
            typeof (prefs as any).whatsapp.enabled === "boolean";

         if (!hasWhatsappEnabled) {
            await NotificationPreferencesService.updatePreferences(uid, {
               whatsapp: { ...AuthService.SIGNUP_WHATSAPP_DEFAULTS },
            } as any);
            logger.info("Initialized whatsapp notification defaults on signup", { uid });
         }
      } catch (error: any) {
         logger.warn("Failed to initialize whatsapp notification defaults (non-blocking)", {
            uid,
            error: error?.message || error,
         });
      }
   }
   /**
    * Sync profile data based on Firebase UID (from session token)
    */
   static async syncProfile(
      uid: string,
      data: { name?: string; phone?: string }
   ): Promise<any> {
      if (!uid) {
         throw new BadRequestError("UID is required");
      }

      const { name, phone } = data;

      try {
         // Find existing profile by Firebase UID or matching phone (reconciliation-safe).
         let profile = await findActiveProfileByUidOrPhone({ uid, phone: data.phone });

         if (profile) {
            // Auto-heal historical drift where same phone profile points to older/different UID.
            if (profile.uid !== uid) {
               logger.warn("syncProfile: UID mismatch detected, healing profile UID by phone", {
                  requestedUid: uid,
                  profileUid: profile.uid,
                  profileId: String((profile as any)._id),
               });
               profile.uid = uid;
            }

            logger.info("🔄 Updating existing profile during sync", { uid });

            // Update fields if provided and different
            const updates: any = {};
            if (name && profile.name !== name) updates.name = name;
            if (phone && profile.phone !== phone) updates.phone = phone;
            if (profile.uid !== uid) updates.uid = uid;

        if (Object.keys(updates).length > 0) {
          updates.updatedAt = Date.now();
          profile = await Profile.findOneAndUpdate(
            { _id: (profile as any)._id },
            { $set: updates },
            { new: true }
          );
        }
      } else {
        logger.info("📝 Creating new profile during sync", { uid });

        // Create new minimal profile
        const now = Date.now();
        profile = await Profile.create({
          uid,
          name: name || "User",
          phone: phone || null,
          // Note: email is not set here - users without email won't receive email notifications
          emailVerified: false,
          roles: [], // New users have no roles
          userType: "individual",
          rating: 0,
          totalReviews: 0,
          createdAt: now,
          updatedAt: now,
        });
      }

         return profile;
      } catch (error: any) {
         logger.error("Sync Profile error:", error);
         throw new BadRequestError(error.message || "Profile sync failed");
      }
   }

   /**
    * Check if phone number exists
    */
   static async checkPhoneExists(
      phone: string
   ): Promise<{ exists: boolean; phone: string }> {
      if (!phone || typeof phone !== "string") {
         throw new BadRequestError("Phone number is required");
      }

      // Clean phone number (remove spaces, ensure +91 prefix)
      const cleanPhone = phone.replace(/\D/g, "");
      const formattedPhone = cleanPhone.startsWith("91")
         ? `+${cleanPhone}`
         : `+91${cleanPhone}`;

      // ✨ Check if profile exists with this phone number
      // Try multiple formats to handle different storage formats
      // Extract just the 10-digit number (last 10 digits)
      const tenDigitNumber =
         cleanPhone.length >= 10
            ? cleanPhone.slice(-10) // Get last 10 digits
            : cleanPhone;

      // Build comprehensive search query covering all possible formats
      const searchFormats = [
         formattedPhone, // +919121577021
         formattedPhone.replace("+91", "+91-"), // +91-9121577021
         cleanPhone, // 919121577021 (without +)
         `+${cleanPhone}`, // +919121577021 (alternative)
         cleanPhone.startsWith("91") ? cleanPhone : `91${cleanPhone}`, // 919121577021 or 91XXXXXXXXXX
         tenDigitNumber, // 9121577021 (10 digits only)
         `+91${tenDigitNumber}`, // +919121577021 (with 10-digit number)
         `91${tenDigitNumber}`, // 919121577021 (without +, with 10-digit)
      ];

      // Remove duplicates
      const uniqueFormats = [...new Set(searchFormats)];

      const searchQuery = {
         'dataPrivacy.accountDeleted': { $ne: true },
         isActive: { $ne: false },
         $or: uniqueFormats.map((format) => ({ phone: format })),
      };

      logger.info("Checking phone existence", {
         formattedPhone,
         cleanPhone,
         tenDigitNumber,
         searchFormats: uniqueFormats,
         searchQuery: JSON.stringify(searchQuery),
      });

      // First try exact match with all formats
      let profile = await Profile.findOne(searchQuery).lean();

      logger.info("Phone check result", {
         exists: !!profile,
         foundPhone: profile?.phone,
         searchedPhone: formattedPhone,
         tenDigitNumber,
      });

      return {
         exists: !!profile,
         phone: formattedPhone,
      };
   }

   /**
    * Get profile by phone (for onboarding/conversion lookup).
    * Returns uid, isAadhaarVerified, name or null if not found.
    * Service-auth only.
    */
   static async getProfileByPhone(
      phone: string
   ): Promise<{ uid: string; isAadhaarVerified: boolean; name?: string } | null> {
      if (!phone || typeof phone !== "string") {
         return null;
      }

      const cleanPhone = phone.replace(/\D/g, "");
      const tenDigitNumber =
         cleanPhone.length >= 10 ? cleanPhone.slice(-10) : cleanPhone;
      const formattedPhone = cleanPhone.startsWith("91")
         ? `+${cleanPhone}`
         : `+91${cleanPhone}`;

      // Match checkPhoneExists: try all common storage formats
      const searchFormats = [
         formattedPhone,
         formattedPhone.replace("+91", "+91-"),
         `+91 ${tenDigitNumber}`,
         `91 ${tenDigitNumber}`,
         cleanPhone,
         `+${cleanPhone}`,
         cleanPhone.startsWith("91") ? cleanPhone : `91${cleanPhone}`,
         tenDigitNumber,
         `+91${tenDigitNumber}`,
         `91${tenDigitNumber}`,
      ];
      const uniqueFormats = [...new Set(searchFormats)];
      let profile = await Profile.findOne({
         'dataPrivacy.accountDeleted': { $ne: true },
         isActive: { $ne: false },
         $or: uniqueFormats.map((format) => ({ phone: format })),
      })
         .select("uid name isAadhaarVerified")
         .lean();

      // Fallback 1: match by last 10 digits (regex)
      if (!profile && tenDigitNumber.length === 10) {
         profile = await Profile.findOne({
            'dataPrivacy.accountDeleted': { $ne: true },
            isActive: { $ne: false },
            $or: [
               { phone: { $regex: new RegExp(`${tenDigitNumber}$`) } },
               { phone: { $regex: new RegExp(`^\\+?91?\\s*${tenDigitNumber}`) } },
            ],
         })
            .select("uid name isAadhaarVerified")
            .lean();
      }

      // Fallback 2: phone contains the 10 digits (with optional spaces/dashes between)
      if (!profile && tenDigitNumber.length === 10) {
         const flexiblePattern = tenDigitNumber.split("").join("\\D*");
         profile = await Profile.findOne({
            'dataPrivacy.accountDeleted': { $ne: true },
            isActive: { $ne: false },
            phone: { $regex: new RegExp(flexiblePattern) },
         })
            .select("uid name isAadhaarVerified")
            .lean();
      }

      if (!profile) {
         logger.warn("getProfileByPhone: no profile found", {
            requestedPhone: phone,
            tenDigitNumber,
            searchFormats: uniqueFormats,
         });
         return null;
      }

      return {
         uid: profile.uid,
         isAadhaarVerified: !!profile.isAadhaarVerified,
         name: profile.name || undefined,
      };
   }

   /**
    * Apply referral on signup (or re-issue grants if a prior attempt failed).
    */
   static async applyReferralOnSignup(
      uid: string,
      profile: { _id: unknown },
      referralCode: string,
      referralChannel?: "poster" | "tasker" | "customer"
   ): Promise<{
      applied: boolean;
      grantsStatus?: string;
      welcomeCoins?: number;
      error?: string;
   }> {
      const code = referralCode.trim().toUpperCase();
      const paymentCfg = referralCoinsPaymentConfig();
      if (!code) {
         logReferralCoins("signup_apply_skip_empty_code", { refereeUid: uid });
         return { applied: false };
      }
      if (!ReferralService.isValidReferralCode(code)) {
         logReferralCoins(
            "signup_apply_skip_invalid_format",
            {
               refereeUid: uid,
               referralCode: code,
               hint: "Expected 4 letters + 4 alphanumeric (e.g. JOHN1A2B)",
            },
            "warn"
         );
         return { applied: false, error: "Invalid referral code format" };
      }

      const profileId = String(profile._id);
      logReferralCoins("signup_apply_start", {
         refereeUid: uid,
         refereeProfileId: profileId,
         referralCode: code,
         rewardsV2: true,
         paymentServiceUrl: paymentCfg.baseURL,
         paymentServiceAuthConfigured: paymentCfg.serviceAuthConfigured,
         paymentServiceAuthPreview: paymentCfg.serviceAuthPreview,
      });

      try {
         const existing = await ReferralRecord.findOne({ refereeId: profileId }).sort({
            createdAt: -1,
         });

         if (existing) {
            logReferralCoins("signup_apply_existing_enrollment", {
               refereeUid: uid,
               enrollmentId: String(existing._id),
               grantsStatus: existing.grantsStatus,
               referralStatus: existing.status,
            });
            if (existing.grantsStatus === "completed") {
               logReferralCoins("signup_apply_success", {
                  refereeUid: uid,
                  enrollmentId: String(existing._id),
                  grantsStatus: "completed",
                  note: "already_completed",
               });
               return { applied: true, grantsStatus: "completed" };
            }
            logReferralCoins("signup_apply_reissue", {
               refereeUid: uid,
               enrollmentId: String(existing._id),
               priorGrantsStatus: existing.grantsStatus,
            });
            const reissue = await ReferralGrantReissue.reissue(existing._id.toString());
            logReferralCoins("signup_apply_success", {
               refereeUid: uid,
               enrollmentId: String(existing._id),
               grantsStatus: reissue.grantsStatus,
               grantsIssued: reissue.grantsIssued,
               grantsFailed: reissue.grantsFailed,
               note: "reissued",
            });
            return {
               applied: true,
               grantsStatus: reissue.grantsStatus,
            };
         }

         const { lookupReferralCodeChannel } = await import("./referralCodeService");
         const codeLookup = await lookupReferralCodeChannel(code);
         if (!codeLookup.valid || !codeLookup.channel) {
            logReferralCoins(
               "signup_apply_skip_invalid_format",
               { refereeUid: uid, referralCode: code },
               "warn"
            );
            return { applied: false, error: "Invalid referral code" };
         }
         if (referralChannel != null && String(referralChannel).trim() !== "") {
            const { parseReferralChannel } = await import("../rewards/utils/walletRole");
            const clientChannel = parseReferralChannel(referralChannel);
            if (clientChannel !== codeLookup.channel) {
               return {
                  applied: false,
                  error: `This code is for ${codeLookup.channel === "poster" ? "customer" : "helper"} signup only`,
               };
            }
         }

         const applyResult = await ReferralApplyOrchestrator.apply({
            refereeUid: uid,
            referralCode: code,
            refereeProfileId: profileId,
            codeChannel: codeLookup.channel,
         });
         logReferralCoins("signup_apply_success", {
            refereeUid: uid,
            enrollmentId: applyResult.enrollmentId,
            grantsStatus: applyResult.grantsStatus,
            welcomeCoins: applyResult.welcomeCoins,
            referrerCoins: applyResult.referrerCoins,
            note: "new_enrollment",
         });
         return {
            applied: true,
            grantsStatus: applyResult.grantsStatus,
            welcomeCoins: applyResult.welcomeCoins,
         };
      } catch (error: unknown) {
         const message = error instanceof Error ? error.message : "Failed to apply referral";
         logReferralCoins(
            "signup_apply_error",
            {
               refereeUid: uid,
               referralCode: code,
               error: message,
               stack: error instanceof Error ? error.stack : undefined,
            },
            "error"
         );
         return { applied: false, error: message };
      }
   }

   private static async buildOtpSuccessResponse(
      uid: string,
      profile: any,
      firebasePhone: string | undefined,
      mode: "login" | "signup",
      referralCode?: string,
      referralChannel?: "poster" | "tasker" | "customer"
   ) {
      if (mode === "signup" && profile && !referralCode?.trim()) {
         logReferralCoins("signup_apply_skip_empty_code", {
            refereeUid: uid,
            note: "completeOTP finished without referralCode — no background apply",
         });
      }

      if (mode === "signup" && profile && referralCode?.trim()) {
         const code = referralCode.trim().toUpperCase();
         logReferralCoins("signup_background_scheduled", {
            refereeUid: uid,
            refereeProfileId: String(profile._id),
            referralCode: code,
         });
         // Never block signup on referral — apply in background when a code was provided.
         void AuthService.applyReferralOnSignup(uid, profile, referralCode, referralChannel)
            .then((result) => {
               logReferralCoins("signup_background_finished", {
                  refereeUid: uid,
                  referralCode: code,
                  applied: result.applied,
                  grantsStatus: result.grantsStatus,
                  welcomeCoins: result.welcomeCoins,
                  error: result.error,
               }, result.applied ? "info" : "warn");
            })
            .catch((err) => {
               logReferralCoins(
                  "signup_apply_error",
                  {
                     refereeUid: uid,
                     referralCode: code,
                     error: err instanceof Error ? err.message : String(err),
                     stack: err instanceof Error ? err.stack : undefined,
                     phase: "background_unhandled",
                  },
                  "error"
               );
            });
      }

      return {
         success: true,
         profile,
         user: {
            uid,
            phone: firebasePhone || null,
         },
      };
   }

   /**
    * Complete OTP authentication flow
    * Verifies Firebase ID token and creates/retrieves user profile
    */
   static async completeOTPAuth( 
      idToken: string,
      mode: "login" | "signup",
      phone: string,
      name?: string,
      clientType: "web" | "mobile" = "web",
      referralCode?: string,
      referralChannel?: "poster" | "tasker" | "customer"
   ): Promise<{
      success: boolean;
      profile?: any;
      user?: { uid: string; phone: string | null };
      error?: string;
   }> {
      /** True only when signup creates a new profile (not "profile already exists" retry). */
      let sendSignupWelcomeWhatsApp = false;

      try {
         // 1. Verify Firebase ID token
         let decodedToken;
         try {
            decodedToken = await auth.verifyIdToken(idToken);
         } catch (error: any) {
            logger.error("Invalid ID token:", error);
            throw new BadRequestError(
               "Invalid or expired authentication token"
            );
         }

         const uid = decodedToken.uid;
         const firebasePhone = decodedToken.phone_number;
         const firebaseEmail = (decodedToken as any)?.email || "";

         // 2. Validate phone match
         const cleanPhone = phone.replace(/\D/g, "");
         const cleanFirebasePhone = firebasePhone?.replace(/\D/g, "") || "";

         // Extract last 10 digits for comparison (handles +91 prefix)
         const phoneLast10 =
            cleanPhone.length >= 10 ? cleanPhone.slice(-10) : cleanPhone;
         const firebaseLast10 =
            cleanFirebasePhone.length >= 10
               ? cleanFirebasePhone.slice(-10)
               : cleanFirebasePhone;

         if (phoneLast10 !== firebaseLast10 && firebasePhone) {
            logger.warn("Phone mismatch", {
               provided: phone,
               firebase: firebasePhone,
            });
            throw new BadRequestError("Phone number mismatch");
         }

         // 3. Get or create profile based on mode
         let profile = await Profile.findOne({ uid }).lean();
         const formattedPhone = cleanPhone.startsWith("91")
            ? `+${cleanPhone}`
            : `+91${cleanPhone}`;

         // Auto-heal: if profile was deleted/recreated and UID drifted, rebind by phone.
         if (!profile) {
            const reconciled = await reconcileProfileUidByPhone({
               firebaseUid: uid,
               phone: formattedPhone,
               preferredName: name || "User",
               applyChanges: true,
            });
            if (reconciled.resolved && reconciled.profile) {
               profile = (await Profile.findById((reconciled.profile as any)._id).lean()) as any;
            }
         }

         const reactivated = await reactivateDeletedProfile({
            firebaseUid: uid,
            phone: formattedPhone,
            preferredName: name || "User",
         });
         if (reactivated) {
            profile = reactivated as any;
            logger.info("Reactivated deleted profile during OTP auth", { uid, mode });
         }

         if (mode === "login") {
            // Login mode: Try to get existing profile, create if doesn't exist (zombie user)
            if (!profile) {
               logger.info("Zombie user detected - creating profile", {
                  uid,
                  phone,
               });

               const now = Date.now();
               
               try {
                  const created = await Profile.create({
                     uid,
                     name: name || "User",
                     phone: formattedPhone,
                     client_type: clientType,
                     roles: [],
                     userType: "individual",
                     rating: 0,
                     totalReviews: 0,
                     totalTasks: 0,
                     completedTasks: 0,
                     isVerified: false,
                     isAadhaarVerified: false,
                     isActive: true,
                     agreeUpdates: false,
                     agreeTerms: false,
                     createdAt: now,
                     updatedAt: now,
                  });

                  profile = created.toObject() as any;
               } catch (error: any) {
                  // Handle duplicate key error (race condition)
                  if (error.code === 11000) {
                     logger.warn("Profile created by concurrent request, fetching existing profile", { uid, phone });
                     profile = await Profile.findOne({ uid }).lean();
                     if (!profile) {
                        // Try phone-based fallback healing for historical drift.
                        const byPhone = await findActiveProfileByUidOrPhone({ phone: formattedPhone });
                        if (byPhone) {
                           await Profile.updateOne(
                              { _id: (byPhone as any)._id },
                              { $set: { uid, updatedAt: Date.now() } }
                           );
                           profile = await Profile.findById((byPhone as any)._id).lean();
                        }
                     }
                     
                     if (!profile) {
                        throw new InternalServerError("Profile creation failed and unable to retrieve existing profile");
                     }
                  } else {
                     throw error;
                  }
               }
            }
         } else {
            // Signup mode: Create new profile
            if (profile) {
               logger.warn("Profile already exists for signup", { uid });

               // Backfill registration source for older profiles created before client_type existed.
               if (!(profile as any).client_type) {
                  await Profile.updateOne({ uid }, { $set: { client_type: clientType } });
                  profile = await Profile.findOne({ uid }).lean();
               }

               // If user retries signup or profile was created before this feature,
               // still create MyOperator contact if we haven't yet.
               if (profile && !(profile as any).myOperatorContactId) {
                  const nameForContact = name || profile?.name || "User";
                  const countryCode = process.env.MYOPERATOR_COUNTRY_CODE || "91";
                  const phoneForContact = phoneLast10 || "";
                  const emailForContact = firebaseEmail || "";
                  const marketingOptIn = true;

                  logger.info("Triggering MyOperator contact creation for existing signup profile", {
                     uid,
                     phoneForContact,
                     emailForContact,
                  });

                  void MyOperatorClient.createContact({
                     name: String(nameForContact),
                     countryCode,
                     phoneNumber: phoneForContact,
                     emailId: String(emailForContact),
                     marketingOptIn,
                  })
                     .then(async (result) => {
                        if (!result) return;
                        if (!result.contactId) {
                           logger.warn("MyOperator createContact returned no contactId; skipping profile update", {
                              uid,
                           });
                           return;
                        }
                        await Profile.updateOne(
                           { uid },
                           {
                              $set: {
                                 myOperatorContactId: result.contactId,
                                 myOperatorContactCreatedAt: new Date(),
                              },
                           }
                        );
                     })
                     .catch((error) => {
                        logger.warn("MyOperator contact creation failed (non-blocking)", {
                           uid,
                           error: error instanceof Error ? error.message : error,
                        });
                     });
               }

               await AuthService.ensureSignupNotificationDefaults(uid);

               if (phoneLast10 && phoneLast10.length >= 10) {
                  const waCountry = process.env.MYOPERATOR_COUNTRY_CODE || "91";
                  logger.info("Triggering MyOperator signup WhatsApp template (existing signup profile)", { uid });
                  void MyOperatorClient.sendSignupWelcomeWhatsAppTemplate({
                     customerCountryCode: waCountry,
                     customerNumber: phoneLast10,
                     templateBody: { name: String((profile as any)?.name || name || "User") },
                  })
                     .then((sent) => {
                        if (sent) {
                           logger.info("Signup WhatsApp template (existing signup profile): sent", { uid });
                           console.log("[Signup][WhatsApp] Template sent successfully (existing signup profile)", { uid });
                        } else {
                           logger.warn("Signup WhatsApp template (existing signup profile): not sent", { uid });
                           console.warn("[Signup][WhatsApp] Template NOT sent (existing signup profile)", { uid });
                        }
                     })
                     .catch((error) => {
                        logger.warn("MyOperator signup WhatsApp template threw (non-blocking, existing signup profile)", {
                           uid,
                           error: error instanceof Error ? error.message : error,
                        });
                     });
               }

               // Return existing profile instead of creating duplicate
               return AuthService.buildOtpSuccessResponse(
                  uid,
                  profile,
                  firebasePhone,
                  mode,
                  referralCode,
                  referralChannel
               );
            } else {
               sendSignupWelcomeWhatsApp = true;
               const now = Date.now();
               
               try {
                  const created = await Profile.create({
                     uid,
                     name: name || "User",
                     phone: formattedPhone,
                     client_type: clientType,
                     roles: [],
                     userType: "individual",
                     rating: 0,
                     totalReviews: 0,
                     totalTasks: 0,
                     completedTasks: 0,
                     isVerified: false,
                     isAadhaarVerified: false,
                     isActive: true,
                     agreeUpdates: false,
                     agreeTerms: false,
                     createdAt: now,
                     updatedAt: now,
                  });

                  profile = created.toObject() as any;
               } catch (error: any) {
                  // Handle duplicate key error (race condition)
                  if (error.code === 11000) {
                     logger.warn("Profile created by concurrent request, fetching existing profile", { uid, phone });
                     profile = await Profile.findOne({ uid }).lean();
                     if (!profile) {
                        const byPhone = await findActiveProfileByUidOrPhone({ phone: formattedPhone });
                        if (byPhone) {
                           await Profile.updateOne(
                              { _id: (byPhone as any)._id },
                              { $set: { uid, updatedAt: Date.now() } }
                           );
                           profile = await Profile.findById((byPhone as any)._id).lean();
                        }
                     }
                     
                     if (!profile) {
                        throw new InternalServerError("Profile creation failed and unable to retrieve existing profile");
                     }
                  } else {
                     throw error;
                  }
               }
            }
         }

         if (mode === "signup") {
            await AuthService.ensureSignupNotificationDefaults(uid);
         }

         // MyOperator contact creation (signup only)
         // Non-blocking: failures should not break OTP signup/login/profile creation.
         if (mode === "signup" && profile && !(profile as any).myOperatorContactId) {
            const nameForContact = name || profile.name || "User";
            const countryCode = process.env.MYOPERATOR_COUNTRY_CODE || "91";
            const phoneForContact = phoneLast10 || "";
            const emailForContact = firebaseEmail || "";
            const marketingOptIn = true;

            logger.info("Triggering MyOperator contact creation for new signup profile", {
               uid,
               phoneForContact,
               emailForContact,
            });

            void MyOperatorClient.createContact({
               name: String(nameForContact),
               countryCode,
               phoneNumber: phoneForContact,
               emailId: String(emailForContact),
               marketingOptIn,
            })
               .then(async (result) => {
                  if (!result) return;
                  if (!result.contactId) {
                     logger.warn("MyOperator createContact returned no contactId; skipping profile update", {
                        uid,
                     });
                     return;
                  }
                  await Profile.updateOne(
                     { uid },
                     {
                        $set: {
                           myOperatorContactId: result.contactId,
                           myOperatorContactCreatedAt: new Date(),
                        },
                     }
                  );
               })
               .catch((error) => {
                  logger.warn("MyOperator contact creation failed (non-blocking)", {
                     uid,
                     error: error instanceof Error ? error.message : error,
                  });
               });
         }

         if (profile) {
            profile = await ensureDemoVerificationProfile(profile);
         }

         if (sendSignupWelcomeWhatsApp && phoneLast10 && phoneLast10.length >= 10) {
            const waCountry = process.env.MYOPERATOR_COUNTRY_CODE || "91";
            logger.info("Triggering MyOperator signup WhatsApp template (new signup profile)", { uid });
            void MyOperatorClient.sendSignupWelcomeWhatsAppTemplate({
               customerCountryCode: waCountry,
               customerNumber: phoneLast10,
               templateBody: { name: String(profile?.name || name || "User") },
            })
               .then((sent) => {
                  if (sent) {
                     logger.info("Signup WhatsApp template (new signup profile): sent", { uid });
                     console.log("[Signup][WhatsApp] Template sent successfully (new signup profile)", { uid });
                  } else {
                     logger.warn("Signup WhatsApp template (new signup profile): not sent", { uid });
                     console.warn("[Signup][WhatsApp] Template NOT sent (new signup profile)", { uid });
                  }
               })
               .catch((error) => {
                  logger.warn("MyOperator signup WhatsApp template threw (non-blocking, new signup profile)", {
                     uid,
                     error: error instanceof Error ? error.message : error,
                  });
               });
         }

         logger.info("OTP auth completed successfully", {
            uid,
            mode,
            profileExists: !!profile,
            phoneLast10: normalizePhoneToLast10(formattedPhone),
         });

         // Send email notifications based on mode (non-blocking)
         if (profile?.email) {
            if (mode === "login") {
               // Login alert for existing user
               EmailServiceClient.sendLoginAlert(
                  profile.email,
                  profile.name || "User",
                  {
                     loginTime: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
                  }
               ).catch(err => logger.warn("Failed to send login alert email", { error: err.message }));
            } else if (mode === "signup") {
               // Welcome email for new user
               EmailServiceClient.sendWelcomeEmail(
                  profile.email,
                  profile.name || "User"
               ).catch(err => logger.warn("Failed to send welcome email", { error: err.message }));
            }
         }

         return AuthService.buildOtpSuccessResponse(
            uid,
            profile,
            firebasePhone,
            mode,
            referralCode,
            referralChannel
         );
      } catch (error: any) {
         logger.error("OTP auth completion error:", error);

         if (error instanceof BadRequestError) {
            throw error;
         }

         throw new InternalServerError(
            error.message || "Failed to complete OTP authentication"
         );
      }
   }

   /**
    * Dev-only: complete OTP auth with fixed Indian dummy numbers + OTP.
    * Enabled only when LOCAL_TEST=true or LOCAL_TEST=1.
    * Allowed test credentials:
    * - +91 9999999999 / OTP 123456
    * - +91 9876543210 / OTP 654321 or 123456
    * - +91 9876543211 / OTP 654321 or 123456
    */
   private static readonly DEV_DUMMY_USERS: Array<{
      phoneLast10: string;
      phoneE164: string;
      otps: string[];
      displayName: string;
   }> = [
      { phoneLast10: "9999999999", phoneE164: "+919999999999", otps: ["123456"], displayName: "Local Test User" },
      { phoneLast10: "9876543210", phoneE164: "+919876543210", otps: ["654321", "123456"], displayName: "Local Test User" },
      { phoneLast10: "9876543211", phoneE164: "+919876543211", otps: ["654321", "123456"], displayName: "Local Test User 2" },
   ];

   static async completeOTPDevAuth(
      phone: string,
      otp: string,
      mode: "login" | "signup",
      name?: string,
      clientType: "web" | "mobile" = "web",
      referralCode?: string,
      referralChannel?: "poster" | "tasker" | "customer"
   ): Promise<{
      success: boolean;
      profile?: any;
      user?: { uid: string; phone: string | null };
      error?: string;
   }> {
      const localTestEnabled =
         process.env.LOCAL_TEST === "true" || process.env.LOCAL_TEST === "1";
      if (!localTestEnabled) {
         throw new BadRequestError("Local test auth not enabled");
      }

      const cleanPhone = String(phone || "").replace(/\D/g, "");
      const phoneLast10 = cleanPhone.length >= 10 ? cleanPhone.slice(-10) : cleanPhone;
      const normalizedOtp = String(otp || "").trim();
      const match = AuthService.DEV_DUMMY_USERS.find(
         (u) => u.phoneLast10 === phoneLast10 && u.otps.includes(normalizedOtp)
      );
      if (!match) {
         throw new BadRequestError("Invalid test credentials");
      }

      const DUMMY_PHONE_E164 = match.phoneE164;
      const DUMMY_DISPLAY_NAME = name || match.displayName;

      // Keep dev OTP path fully local and deterministic; avoids external Firebase timeouts.
      const uid = `local-test-${match.phoneLast10}`;
      logger.info("Dev dummy UID resolved", { uid, phone: DUMMY_PHONE_E164 });

      let profile = await Profile.findOne({ uid }).lean();
      const formattedPhone = DUMMY_PHONE_E164;
      const now = Date.now();
      const displayName = name || DUMMY_DISPLAY_NAME;

      if (!profile) {
         const reconciled = await reconcileProfileUidByPhone({
            firebaseUid: uid,
            phone: formattedPhone,
            preferredName: displayName,
            applyChanges: true,
         });
         if (reconciled.resolved && reconciled.profile) {
            profile = (await Profile.findById((reconciled.profile as any)._id).lean()) as any;
         }
      }

      const reactivated = await reactivateDeletedProfile({
         firebaseUid: uid,
         phone: formattedPhone,
         preferredName: displayName,
         resolveDummyPhoneCollision: true,
      });
      if (reactivated) {
         profile = reactivated as any;
         logger.info("Reactivated deleted profile during completeOTPDevAuth", { uid, mode });
      }

      if (mode === "login") {
         if (!profile) {
            try {
               const created = await Profile.create({
                  uid,
                  name: displayName,
                  phone: formattedPhone,
                  client_type: clientType,
                  roles: [],
                  userType: "individual",
                  rating: 0,
                  totalReviews: 0,
                  totalTasks: 0,
                  completedTasks: 0,
                  isVerified: false,
                  isAadhaarVerified: false,
                  isActive: true,
                  agreeUpdates: false,
                  agreeTerms: false,
                  createdAt: now,
                  updatedAt: now,
               });
               profile = created.toObject() as any;
            } catch (error: any) {
               if (error.code === 11000) {
                 // Duplicate key: could be on uid or phone. Find by either.
                 profile = await Profile.findOne({ $or: [{ uid }, { phone: formattedPhone }] }).lean();
                 if (!profile) throw new InternalServerError("Profile creation failed");
                 // If found by phone but uid differs, update uid to match current Firebase user
                 if (profile.uid !== uid) {
                   await Profile.updateOne({ _id: (profile as any)._id }, { $set: { uid } });
                   profile = { ...profile, uid };
                 }
               } else throw error;
            }
         }
      } else {
         if (profile) {
            logger.info("Dev dummy signup: profile already exists", { uid });
            if (!(profile as any).client_type) {
              await Profile.updateOne({ uid }, { $set: { client_type: clientType } });
              profile = await Profile.findOne({ uid }).lean();
            }
         } else {
            try {
               const created = await Profile.create({
                  uid,
                  name: displayName,
                  phone: formattedPhone,
                  client_type: clientType,
                  roles: [],
                  userType: "individual",
                  rating: 0,
                  totalReviews: 0,
                  totalTasks: 0,
                  completedTasks: 0,
                  isVerified: false,
                  isAadhaarVerified: false,
                  isActive: true,
                  agreeUpdates: false,
                  agreeTerms: false,
                  createdAt: now,
                  updatedAt: now,
               });
               profile = created.toObject() as any;
            } catch (error: any) {
               if (error.code === 11000) {
                 // Duplicate key: could be on uid or phone. Find by either.
                 profile = await Profile.findOne({ $or: [{ uid }, { phone: formattedPhone }] }).lean();
                 if (!profile) throw new InternalServerError("Profile creation failed");
                 // If found by phone but uid differs, update uid to match current Firebase user
                 if (profile.uid !== uid) {
                   await Profile.updateOne({ _id: (profile as any)._id }, { $set: { uid } });
                   profile = { ...profile, uid };
                 }
               } else throw error;
            }
         }
      }

      if (!profile) {
         throw new InternalServerError("Profile not found after create");
      }

      const verifiedProfile = await ensureDemoVerificationProfile(profile);

      logger.info("Dev OTP auth completed", {
         uid: verifiedProfile.uid,
         phone: formattedPhone,
         mode,
      });

      return AuthService.buildOtpSuccessResponse(
         verifiedProfile.uid,
         verifiedProfile,
         verifiedProfile.phone || formattedPhone,
         mode,
         referralCode,
         referralChannel
      );
   }
}
