import { Response, Request } from "express";
import { AuthenticatedRequest } from "../types";
import { AuthService } from "../services/AuthService";
import { AlternatePhoneService } from "../services/AlternatePhoneService";
import { SessionService } from "../services/SessionService";
import {
   setRefreshTokenCookie,
   setAccessTokenCookie,
} from "../utils/sessionCookies";
import type { ClientType } from "../models/SessionToken";
import { logReferralCoins } from "../rewards/referral/referralCoinsLogger";
import { parseReferralChannel } from "../rewards/utils/walletRole";
import logger from "../config/logger";

export class AuthController {
   static async checkPhone(
      req: AuthenticatedRequest,
      res: Response
   ): Promise<void> {
      const { phone } = req.body;
      const result = await AuthService.checkPhoneExists(phone);

      res.json({
         success: true,
         exists: result.exists,
         phone: result.phone,
         matchType: result.matchType,
      });
   }

   static async sendAlternateLoginOtp(req: Request, res: Response): Promise<void> {
      const { phone } = req.body;
      if (!phone || typeof phone !== "string") {
         res.status(400).json({ success: false, error: "Phone number is required" });
         return;
      }

      const result = await AlternatePhoneService.sendAlternateLoginOtp(phone);
      res.json(result);
   }

   static async verifyAlternateLoginOtp(req: Request, res: Response): Promise<void> {
      const { phone, otp } = req.body;
      if (!phone || typeof phone !== "string" || !otp) {
         res.status(400).json({
            success: false,
            error: "Phone number and OTP are required",
         });
         return;
      }

      const result = await AlternatePhoneService.verifyAlternateLoginOtp(phone, otp);
      res.json(result);
   }

   static async completeAlternateLoginFirebase(req: Request, res: Response): Promise<void> {
      const { phone, alternateIdToken } = req.body;
      if (!phone || typeof phone !== "string" || !alternateIdToken) {
         res.status(400).json({
            success: false,
            error: "Phone number and verification token are required",
         });
         return;
      }

      const result = await AlternatePhoneService.completeAlternateLoginFirebase(
         phone,
         alternateIdToken
      );
      res.json(result);
   }

   static async restoreFirebaseSession(req: Request, res: Response): Promise<void> {
      const { idToken } = req.body;
      if (!idToken || typeof idToken !== "string") {
         res.status(400).json({ success: false, error: "Session token is required" });
         return;
      }

      const result = await AlternatePhoneService.restoreFirebaseSession(idToken);
      res.json(result);
   }

   /**
    * POST /api/v1/auth/user-by-phone
    * Service-auth only. Returns platform user uid and Aadhaar verification status for onboarding.
    */
   static async getUserByPhone(req: Request, res: Response): Promise<void> {
      const { phone } = req.body;
      if (!phone || typeof phone !== "string") {
         res.status(400).json({
            success: false,
            error: "Phone number is required",
         });
         return;
      }

      const profile = await AuthService.getProfileByPhone(phone);
      if (!profile) {
         res.status(404).json({
            success: false,
            error: "No user found for this phone",
         });
         return;
      }

      res.json({
         success: true,
         data: {
            uid: profile.uid,
            isAadhaarVerified: profile.isAadhaarVerified,
            name: profile.name,
         },
      });
   }

   /**
    * POST /api/v1/auth/sync
    * Authenticated endpoint to sync Firebase user with MongoDB profile
    */
   static async sync(req: AuthenticatedRequest, res: Response): Promise<void> {
      const uid = req.user?.uid;
      if (!uid) {
         res.status(401).json({ success: false, message: "Unauthorized" });
         return;
      }

      const { name, phone } = req.body;
      const profile = await AuthService.syncProfile(uid, { name, phone });

      res.json({
         success: true,
         data: profile,
      });
   }

   /**
    * POST /api/v1/auth/otp/complete
    * Completes OTP authentication flow
    */
   static async completeOTP(
      req: AuthenticatedRequest,
      res: Response
   ): Promise<void> {
      try {
         const { idToken, mode, phone, name, clientType, deviceId, referralCode, referralChannel } = req.body;

         if (!idToken || !mode || !phone) {
            res.status(400).json({
               success: false,
               error: "Missing required fields: idToken, mode, phone",
            });
            return;
         }

         if (mode !== "login" && mode !== "signup") {
            res.status(400).json({
               success: false,
               error: 'Invalid mode. Must be "login" or "signup"',
            });
            return;
         }

         const normalizedClient: ClientType =
            clientType === "mobile" ? "mobile" : "web";

         if (mode === "signup" && typeof referralCode === "string" && referralCode.trim()) {
            logReferralCoins("api_apply_request", {
               phase: "otp_complete",
               referralCode: referralCode.trim().toUpperCase(),
               clientType: normalizedClient,
               phoneLast4: String(phone).replace(/\D/g, "").slice(-4),
            });
         }

         const phoneLast10 = String(phone).replace(/\D/g, "").slice(-10);
         logger.info("[Signup][WA] otp/complete received", {
            mode,
            clientType: normalizedClient,
            phoneLast4: phoneLast10.slice(-4),
            willRunMyOperator: mode === "signup",
         });

         const result = await AuthService.completeOTPAuth(
            idToken,
            mode,
            phone,
            name,
            normalizedClient,
            typeof referralCode === "string" ? referralCode : undefined,
            referralChannel != null && String(referralChannel).trim() !== ""
               ? parseReferralChannel(referralChannel)
               : undefined
         );

         // Use Firebase UID (profile.uid) for session, NOT MongoDB _id
         // This ensures all services that search by `uid` field continue to work
         const firebaseUid = result.profile?.uid;
         if (!firebaseUid) {
            res.status(500).json({
               success: false,
               error: "Missing profile UID after authentication",
            });
            return;
         }

         const tokens = await SessionService.createSession({
            uid: firebaseUid,  // Use Firebase UID, not MongoDB _id
            clientType: normalizedClient,
            deviceId,
            userAgent: req.get("user-agent") ?? undefined,
            ipAddress: req.ip,
         });

         if (normalizedClient === "web") {
            setRefreshTokenCookie(
               res,
               tokens.refreshToken,
               tokens.refreshTokenExpiresAt
            );
            setAccessTokenCookie(
               res,
               tokens.accessToken,
               tokens.accessTokenExpiresAt
            );

            res.json({
               ...result,
               success: true,
               sessionId: tokens.sessionId,
               accessTokenExpiresAt: tokens.accessTokenExpiresAt.toISOString(),
            });
         } else {
            const tokenPayload: Record<string, any> = {
               accessToken: tokens.accessToken,
               accessTokenExpiresAt: tokens.accessTokenExpiresAt.toISOString(),
               sessionId: tokens.sessionId,
               refreshToken: tokens.refreshToken,
               refreshTokenExpiresAt:
                  tokens.refreshTokenExpiresAt.toISOString(),
            };

            res.json({
               ...result,
               tokens: tokenPayload,
            });
         }
      } catch (error: any) {
         res.status(error.statusCode || 500).json({
            success: false,
            error: error.message || "Failed to complete OTP authentication",
         });
      }
   }

   /**
    * POST /api/v1/auth/otp/complete-dev
    * Dev-only: dummy signin/signup. Allowed:
    * +91 9999999999 with OTP 123456;
    * +91 9876543210 with OTP 654321 or 123456;
    * +91 9876543211 with OTP 654321 or 123456.
    * Enabled only when LOCAL_TEST=true or LOCAL_TEST=1.
    */
   static async completeOTPDev(
      req: Request,
      res: Response
   ): Promise<void> {
      try {
         const allowDev =
            process.env.LOCAL_TEST === "true" ||
            process.env.LOCAL_TEST === "1";
         if (!allowDev) {
            res.status(404).json({ success: false, error: "Not found" });
            return;
         }

         const { phone, otp, mode, name, clientType, deviceId, referralCode, referralChannel } = req.body;
         if (!phone || !otp || !mode) {
            res.status(400).json({
               success: false,
               error: "Missing required fields: phone, otp, mode",
            });
            return;
         }
         if (mode !== "login" && mode !== "signup") {
            res.status(400).json({
               success: false,
               error: 'Invalid mode. Must be "login" or "signup"',
            });
            return;
         }

         const normalizedClient: ClientType =
            clientType === "mobile" ? "mobile" : "web";

         const result = await AuthService.completeOTPDevAuth(
            phone,
            otp,
            mode,
            name,
            normalizedClient,
            typeof referralCode === "string" ? referralCode : undefined,
            referralChannel != null && String(referralChannel).trim() !== ""
               ? parseReferralChannel(referralChannel)
               : undefined
         );
         const firebaseUid = result.profile?.uid;
         if (!firebaseUid) {
            res.status(500).json({
               success: false,
               error: "Missing profile UID",
            });
            return;
         }

         const tokens = await SessionService.createSession({
            uid: firebaseUid,
            clientType: normalizedClient,
            deviceId,
            userAgent: req.get("user-agent") ?? undefined,
            ipAddress: req.ip,
         });

         if (normalizedClient === "web") {
            setRefreshTokenCookie(
               res,
               tokens.refreshToken,
               tokens.refreshTokenExpiresAt
            );
            setAccessTokenCookie(
               res,
               tokens.accessToken,
               tokens.accessTokenExpiresAt
            );
            res.json({
               ...result,
               success: true,
               sessionId: tokens.sessionId,
               accessTokenExpiresAt: tokens.accessTokenExpiresAt.toISOString(),
            });
         } else {
            res.json({
               ...result,
               tokens: {
                  accessToken: tokens.accessToken,
                  accessTokenExpiresAt: tokens.accessTokenExpiresAt.toISOString(),
                  sessionId: tokens.sessionId,
                  refreshToken: tokens.refreshToken,
                  refreshTokenExpiresAt: tokens.refreshTokenExpiresAt.toISOString(),
               },
            });
         }
      } catch (error: any) {
         res.status(error.statusCode || 500).json({
            success: false,
            error: error.message || "Invalid test credentials or dev OTP not allowed",
         });
      }
   }
}
