import { Response } from "express";
import { AuthenticatedRequest } from "../types";
import { AuthService } from "../services/AuthService";

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
         const { idToken, mode, phone, name } = req.body;

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

         const result = await AuthService.completeOTPAuth(
            idToken,
            mode,
            phone,
            name
         );

         res.json(result);
      } catch (error: any) {
         res.status(error.statusCode || 500).json({
            success: false,
            error: error.message || "Failed to complete OTP authentication",
         });
      }
   }
}
