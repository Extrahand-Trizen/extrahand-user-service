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
} from "../utils/identityReconciliation";

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
    * Complete OTP authentication flow
    * Verifies Firebase ID token and creates/retrieves user profile
    */
   static async completeOTPAuth( 
      idToken: string,
      mode: "login" | "signup",
      phone: string,
      name?: string
   ): Promise<{
      success: boolean;
      profile?: any;
      user?: { uid: string; phone: string | null };
      error?: string;
   }> {
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

         // If this UID belongs to a deleted account, reactivate it for fresh onboarding.
         if (profile && ((profile as any).dataPrivacy?.accountDeleted || profile.isActive === false)) {
            const reactivated = await Profile.findOneAndUpdate(
               { uid },
               {
                  $set: {
                     name: name || "User",
                     phone: formattedPhone,
                     isActive: true,
                     status: "active",
                     updatedAt: Date.now(),
                     'dataPrivacy.deletionRequested': false,
                     'dataPrivacy.deletionRequestedAt': null,
                     'dataPrivacy.deletionScheduledFor': null,
                     'dataPrivacy.accountDeleted': false,
                     'dataPrivacy.accountDeletedAt': null,
                     'dataPrivacy.accountDeletionReason': null,
                  },
               },
               { new: true }
            ).lean();

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

               // If user retries signup or profile was created before this feature,
               // still create MyOperator contact if we haven't yet.
               if (!(profile as any).myOperatorContactId) {
                  const nameForContact = name || profile.name || "User";
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
                        const update: any = {
                           myOperatorContactCreatedAt: new Date(),
                        };
                        if (result.contactId) {
                           update.myOperatorContactId = result.contactId;
                        }
                        await Profile.updateOne({ uid }, { $set: update });
                     })
                     .catch((error) => {
                        logger.warn("MyOperator contact creation failed (non-blocking)", {
                           uid,
                           error: error instanceof Error ? error.message : error,
                        });
                     });
               }

               await AuthService.ensureSignupNotificationDefaults(uid);

               // Return existing profile instead of creating duplicate
               return {
                  success: true,
                  profile,
                  user: {
                     uid,
                     phone: firebasePhone || null,
                  },
               };
            } else {
               const now = Date.now();
               
               try {
                  const created = await Profile.create({
                     uid,
                     name: name || "User",
                     phone: formattedPhone,
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

                  const update: any = {
                     myOperatorContactCreatedAt: new Date(),
                  };

                  if (result.contactId) {
                     update.myOperatorContactId = result.contactId;
                  }

                  await Profile.updateOne({ uid }, { $set: update });
               })
               .catch((error) => {
                  logger.warn("MyOperator contact creation failed (non-blocking)", {
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

         return {
            success: true,
            profile,
            user: {
               uid,
               phone: firebasePhone || null,
            },
         };
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
      name?: string
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

      if (mode === "login") {
         if (!profile) {
            try {
               const created = await Profile.create({
                  uid,
                  name: displayName,
                  phone: formattedPhone,
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
         } else {
            try {
               const created = await Profile.create({
                  uid,
                  name: displayName,
                  phone: formattedPhone,
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

      logger.info("Dev OTP auth completed", { uid: profile.uid, phone: formattedPhone, mode });

      return {
         success: true,
         profile,
         user: { uid: profile.uid, phone: profile.phone || null },
      };
   }
}
