import { Response } from "express";
import { AuthenticatedRequest } from "../types";
import { SessionService } from "../services/SessionService";
import {
   extractRefreshToken,
   setRefreshTokenCookie,
   setAccessTokenCookie,
   clearAuthCookies,
} from "../utils/sessionCookies";
import type { ClientType } from "../models/SessionToken";
import { UnauthorizedError } from "../errors/AppError";

export class SessionController {
   static async validate(
      req: AuthenticatedRequest,
      res: Response
   ): Promise<void> {
      const { uid, sessionId, tokenId } = req.body ?? {};
      if (
         typeof uid !== "string" ||
         typeof sessionId !== "string" ||
         (tokenId !== undefined && typeof tokenId !== "string")
      ) {
         res.status(400).json({
            success: false,
            error: "uid, sessionId, and an optional tokenId are required",
         });
         return;
      }

      const active = await SessionService.isAccessSessionActive(
         uid,
         sessionId,
         tokenId
      );
      res.json({ success: true, active });
   }

   static async refresh(
      req: AuthenticatedRequest,
      res: Response
   ): Promise<void> {
      const refreshToken = extractRefreshToken(req);

      if (!refreshToken) {
         throw new UnauthorizedError("Refresh token missing");
      }

      const normalizedClient: ClientType =
         req.body?.clientType === "mobile" ? "mobile" : "web";

      const tokens = await SessionService.refreshSession(refreshToken, {
         userAgent: req.get("user-agent") ?? undefined,
         deviceId: req.body?.deviceId,
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
            success: true,
            sessionId: tokens.sessionId,
            accessTokenExpiresAt: tokens.accessTokenExpiresAt.toISOString(),
         });
      } else {
         const payload: Record<string, any> = {
            accessToken: tokens.accessToken,
            accessTokenExpiresAt: tokens.accessTokenExpiresAt.toISOString(),
            sessionId: tokens.sessionId,
            refreshToken: tokens.refreshToken,
            refreshTokenExpiresAt: tokens.refreshTokenExpiresAt.toISOString(),
         };

         res.json({
            success: true,
            tokens: payload,
         });
      }
   }

   static async logout(
      req: AuthenticatedRequest,
      res: Response
   ): Promise<void> {
      const refreshToken = extractRefreshToken(req);
      if (refreshToken) {
         await SessionService.revokeRefreshToken(refreshToken, "logout");
      }

      clearAuthCookies(res);

      res.json({
         success: true,
         message: "Session terminated",
      });
   }
}
