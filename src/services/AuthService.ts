import {
   getFirebaseTokenVerificationHint,
   verifyFirebaseIdToken,
} from "../utils/verifyFirebaseIdToken";
import Profile from "../models/Profile";
import { BadRequestError, InternalServerError } from "../errors/AppError";
import logger from "../config/logger";
import { EmailServiceClient } from "../clients/EmailServiceClient";
import { MessagingServiceClient } from "../clients/MessagingServiceClient";
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
import {
   findProfileByAnyRegisteredPhone,
   findProfileByVerifiedAlternatePhone,
   isPhoneUsedGlobally,
   normalizePhoneToE164,
   profileHasVerifiedAlternate,
} from "../utils/phoneUtils";

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

   /** On signup, prefer the name from the form over an existing profile / Firebase display name. */
   private static async applySignupNameFromRequest(
      uid: string,
      profile: any,
      name?: string
   ): Promise<any> {
      const trimmed = name?.trim();
      if (!trimmed || trimmed === "User") return profile;
      if (profile?.name === trimmed) return profile;
      await Profile.updateOne({ uid }, { $set: { name: trimmed, updatedAt: Date.now() } });
      const updated = await Profile.findOne({ uid }).lean();
      logger.info("Signup name updated from request", {
         uid,
         previousName: profile?.name,
         newName: trimmed,
      });
      return updated || { ...profile, name: trimmed };
   }

   /**
    * Non-blocking MyOperator contact + signup WhatsApp template (used on signup).
    */
   private static triggerSignupMyOperatorIntegrations(args: {
      uid: string;
      profile: any;
      phoneLast10: string;
      name?: string;
      email?: string;
   }): void {
      const { uid, profile, phoneLast10, name, email } = args;
      const trimmedRequestName = name?.trim();
      const profileName =
         trimmedRequestName && trimmedRequestName !== "User"
            ? trimmedRequestName
            : profile?.name || "User";
      const emailForContact = email || "";

      if (!phoneLast10 || phoneLast10.length < 10) return;

      const roles = (profile as { roles?: string[] })?.roles;
      let signupRole: string | undefined;
      if (Array.isArray(roles)) {
         if (roles.includes("tasker") && !roles.includes("poster")) {
            signupRole = "helper";
         } else if (roles.includes("poster") && !roles.includes("tasker")) {
            signupRole = "poster";
         }
      }

      logger.info("Triggering signup WhatsApp (contact + template)", {
         uid,
         whatsAppName: profileName,
         signupRole,
      });

      void MessagingServiceClient.sendSignupWelcome({
         uid,
         name: profileName,
         email: emailForContact,
         role: signupRole,
         templateBody: { var_1: String(profileName) },
      })
         .then((sent) => {
            if (sent) {
               logger.info("Signup WhatsApp template: sent", { uid });
            } else {
               logger.warn("Signup WhatsApp template: not sent", { uid });
            }
         })
         .catch((err: unknown) => {
            logger.warn("Signup WhatsApp template failed (non-blocking)", {
               uid,
               error: err instanceof Error ? err.message : String(err),
            });
         });
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
   ): Promise<{ exists: boolean; phone: string; matchType?: "primary" | "alternate"; hasTaskerRole?: boolean }> {
      if (!phone || typeof phone !== "string") {
         throw new BadRequestError("Phone number is required");
      }

      const formattedPhone = normalizePhoneToE164(phone);

      const { profile, matchType } = await findProfileByAnyRegisteredPhone(formattedPhone);

      if (profile) {
         logger.info("Phone check result", {
            exists: true,
            matchType,
            foundUid: profile.uid,
            searchedPhone: formattedPhone,
         });
         return {
            exists: true,
            phone: formattedPhone,
            matchType: matchType || undefined,
            hasTaskerRole: Array.isArray(profile.roles) && (
              profile.roles.includes("tasker") ||
              profile.roles.includes("helper") ||
              profile.roles.includes("performer") ||
              profile.roles.includes("both")
            ),
         };
      }

      const pendingUsage = await isPhoneUsedGlobally(formattedPhone);
      if (pendingUsage.used) {
         logger.info("Phone check result (pending reservation)", {
            exists: true,
            matchType: pendingUsage.matchType,
            ownerUid: pendingUsage.ownerUid,
            searchedPhone: formattedPhone,
         });
         return {
            exists: true,
            phone: formattedPhone,
            matchType: pendingUsage.matchType,
         };
      }

      logger.info("Phone check result", {
         exists: false,
         searchedPhone: formattedPhone,
      });

      return {
         exists: false,
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
    ): Promise<{ uid: string; isAadhaarVerified: boolean; name?: string; createdAt?: Date } | null> {
      if (!phone || typeof phone !== "string") {
         return null;
      }

      const formattedPhone = normalizePhoneToE164(phone);
      const { profile } = await findProfileByAnyRegisteredPhone(formattedPhone);

      if (!profile) {
         logger.warn("getProfileByPhone: no profile found", {
            requestedPhone: phone,
            formattedPhone,
         });
         return null;
      }

      return {
         uid: profile.uid,
         isAadhaarVerified: !!profile.isAadhaarVerified,
         name: profile.name || undefined,
         createdAt: profile.createdAt,
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
      /** True when signup flow creates a profile in this request (login zombie create does not set this). */
      let isNewProfileThisRequest = false;

      try {
         // 1. Verify Firebase ID token
         let decodedToken;
         try {
            decodedToken = await verifyFirebaseIdToken(idToken);
         } catch (error: any) {
            logger.error("Invalid ID token:", error);
            const hint = getFirebaseTokenVerificationHint(idToken);
            throw new BadRequestError(
               hint || "Invalid or expired authentication token"
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
         const formattedPhone = normalizePhoneToE164(phone);

         if (phoneLast10 !== firebaseLast10 && firebasePhone) {
            const alternateProfile = await findProfileByVerifiedAlternatePhone(formattedPhone);
            const loginViaAlternate =
               !!alternateProfile &&
               alternateProfile.uid === uid &&
               profileHasVerifiedAlternate(alternateProfile, formattedPhone);

            if (!loginViaAlternate) {
               logger.warn("Phone mismatch", {
                  provided: phone,
                  firebase: firebasePhone,
               });
               throw new BadRequestError("Phone number mismatch");
            }

            logger.info("Alternate phone login accepted", {
               uid,
               alternatePhone: formattedPhone,
            });
         }

         // 3. Get or create profile based on mode
         let profile = await Profile.findOne({ uid }).lean();

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
                  isNewProfileThisRequest = true;
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

               await AuthService.ensureSignupNotificationDefaults(uid);

               profile = await AuthService.applySignupNameFromRequest(uid, profile, name);

               AuthService.triggerSignupMyOperatorIntegrations({
                  uid,
                  profile,
                  phoneLast10,
                  name,
                  email: firebaseEmail || "",
               });

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
               const phoneUsage = await isPhoneUsedGlobally(formattedPhone, uid);
               if (phoneUsage.used) {
                  throw new BadRequestError(
                     "This mobile number is already linked to another account. Please use a different number."
                  );
               }

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
                  isNewProfileThisRequest = true;
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

         if (profile) {
            profile = await ensureDemoVerificationProfile(profile);
         }

         // Signup: always run MyOperator (new profile, retry signup, or existing profile path already triggered above).
         if (mode === "signup" && profile) {
            profile = await AuthService.applySignupNameFromRequest(uid, profile, name);
            AuthService.triggerSignupMyOperatorIntegrations({
               uid,
               profile,
               phoneLast10,
               name,
               email: firebaseEmail || "",
            });
         } else if (mode === "login" && isNewProfileThisRequest && profile) {
            logger.info("Login created new profile — running signup MyOperator flow", { uid });
            AuthService.triggerSignupMyOperatorIntegrations({
               uid,
               profile,
               phoneLast10,
               name: name || profile?.name,
               email: firebaseEmail || "",
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
      { phoneLast10: "7416337859", phoneE164: "+917416337859", otps: ["123456"], displayName: "WA Test User" },
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

      if (mode === "signup") {
         await AuthService.ensureSignupNotificationDefaults(verifiedProfile.uid);
         AuthService.triggerSignupMyOperatorIntegrations({
            uid: verifiedProfile.uid,
            profile: verifiedProfile,
            phoneLast10,
            name: displayName,
            email: "",
         });
      }

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
