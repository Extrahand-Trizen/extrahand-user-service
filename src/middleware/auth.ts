import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../types";
import { validateEnv } from "../config/env";
import { SessionService } from "../services/SessionService";
import logger from "../config/logger";

const env = validateEnv();

function extractBearerToken(
   headerValue: string | undefined
): string | undefined {
   if (!headerValue) return undefined;
   const match = /^Bearer (.+)$/.exec(headerValue);
   return match?.[1];
}

export async function authMiddleware(
   req: AuthenticatedRequest,
   res: Response,
   next: NextFunction
): Promise<void> {
   try {
      const headerToken = extractBearerToken(req.headers.authorization);

      if (!headerToken) {
         res.status(401).json({ error: "Missing Authorization header" });
         return;
      }

      const session = SessionService.verifyAccessToken(headerToken);
      req.user = {
         uid: session.uid,
         sessionId: session.sessionId,
         token: headerToken,
      };
      next();
   } catch (e) {
      logger.warn("Authentication failed", { error: e });
      res.status(401).json({ error: "Invalid token" });
      return;
   }
}

// Optional auth middleware - sets req.user if token is present, but doesn't require it
export async function optionalAuthMiddleware(
   req: AuthenticatedRequest,
   _res: Response,
   next: NextFunction
): Promise<void> {
   const headerToken = extractBearerToken(req.headers.authorization);

   if (headerToken) {
      try {
         const session = SessionService.verifyAccessToken(headerToken);
         req.user = {
            uid: session.uid,
            sessionId: session.sessionId,
            token: headerToken,
         };
      } catch {
         req.user = undefined;
      }
   } else {
      req.user = undefined;
   }

   next();
}

/**
 * Combined auth middleware - accepts either Firebase token OR service auth
 * For service-to-service calls, sets req.user from X-User-Id header
 */
export async function combinedAuthMiddleware(
   req: AuthenticatedRequest,
   res: Response,
   next: NextFunction
): Promise<void> {
   // Check for service auth first (for inter-service calls)
   const serviceAuthToken = req.headers["x-service-auth"] as string;
   const userId = req.headers["x-user-id"] as string;

   if (serviceAuthToken && userId) {
      try {
         if (serviceAuthToken === env.SERVICE_AUTH_TOKEN) {
            // Set user from service auth - this allows the controller to work
            req.user = { uid: userId };
            next();
            return;
         } else {
            res.status(403).json({
               success: false,
               error: "Invalid service authentication token",
            });
            return;
         }
      } catch (error: any) {
         res.status(500).json({
            success: false,
            error: "Service authentication error",
            message: error.message,
         });
         return;
      }
   }

   // Fall back to Firebase token auth
   try {
      const headerToken = extractBearerToken(req.headers.authorization);
      if (!headerToken) {
         res.status(401).json({ error: "Missing Authorization header" });
         return;
      }

      const session = SessionService.verifyAccessToken(headerToken);
      req.user = {
         uid: session.uid,
         sessionId: session.sessionId,
         token: headerToken,
      };
      next();
   } catch (e) {
      logger.warn("Combined auth failed", { error: e });
      res.status(401).json({ error: "Invalid token" });
      return;
   }
}
