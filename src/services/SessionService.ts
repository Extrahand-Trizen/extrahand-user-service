import jwt, { JwtPayload } from "jsonwebtoken";
import { randomUUID, createHash } from "crypto";
import SessionToken, { ClientType } from "../models/SessionToken";
import { validateEnv } from "../config/env";
import logger from "../config/logger";
import { UnauthorizedError, BadRequestError } from "../errors/AppError";

const env = validateEnv();
const ACCESS_TOKEN_SECRET = env.ACCESS_TOKEN_SECRET;
const REFRESH_TOKEN_SECRET = env.REFRESH_TOKEN_SECRET;
const ACCESS_TOKEN_TTL_SECONDS = env.ACCESS_TOKEN_TTL_MINUTES * 60;
const REFRESH_TOKEN_TTL_SECONDS = env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60;
const TOKEN_ISSUER = "extrahand-user-service";
const TOKEN_AUDIENCE = "extrahand-clients";

export interface TokenIssueMetadata {
   // uid is the canonical MongoDB user _id (not the Firebase UID)
   uid: string;
   sessionId?: string;
   clientType: ClientType;
   userAgent?: string;
   deviceId?: string;
   ipAddress?: string;
}

export interface TokenPair {
   sessionId: string;
   userId: string;
   accessToken: string;
   accessTokenExpiresAt: Date;
   refreshToken: string;
   refreshTokenExpiresAt: Date;
   refreshTokenId: string;
}

interface AccessTokenClaims extends JwtPayload {
   sub: string;
   sid: string;
   tid?: string;
}

interface RefreshTokenClaims extends JwtPayload {
   sub: string;
   sid: string;
   jti: string;
}

function hashToken(token: string): string {
   return createHash("sha256").update(token).digest("hex");
}

export class SessionService {
   static async createSession(
      metadata: TokenIssueMetadata
   ): Promise<TokenPair> {
      if (!metadata.uid) {
         throw new BadRequestError(
            "Unable to create session without user context"
         );
      }

      const sessionId = metadata.sessionId ?? randomUUID();
      return this.issueTokens({ ...metadata, sessionId });
   }

   static async refreshSession(
      refreshToken: string,
      overrides: Partial<Omit<TokenIssueMetadata, "uid">> & {
         ipAddress?: string;
         userAgent?: string;
      }
   ): Promise<TokenPair> {
      if (!refreshToken) {
         throw new UnauthorizedError("Refresh token required");
      }

      let claims: RefreshTokenClaims;
      try {
         claims = jwt.verify(refreshToken, REFRESH_TOKEN_SECRET, {
            issuer: TOKEN_ISSUER,
            audience: TOKEN_AUDIENCE,
         }) as RefreshTokenClaims;
      } catch (error) {
         logger.warn("Refresh token verification failed", { error });
         throw new UnauthorizedError("Invalid refresh token");
      }

      const hashed = hashToken(refreshToken);
      const stored = await SessionToken.findOne({
         refreshTokenHash: hashed,
      }).lean();

      if (!stored) {
         logger.warn("Refresh token missing from store", {
            tokenId: claims.jti,
            userId: claims.sub,
         });
         throw new UnauthorizedError("Refresh token not recognized");
      }

      if (
         stored.tokenId !== claims.jti ||
         stored.sessionId !== claims.sid ||
         stored.userId !== claims.sub
      ) {
         // Force strict binding between token claims and stored session record
         logger.warn("Refresh token claim mismatch", {
            tokenId: claims.jti,
            storedTokenId: stored.tokenId,
            sessionId: claims.sid,
            storedSessionId: stored.sessionId,
            claimedUser: claims.sub,
            storedUser: stored.userId,
         });
         throw new UnauthorizedError("Refresh token not recognized");
      }

      if (stored.revokedAt) {
         throw new UnauthorizedError("Refresh token already revoked");
      }

      if (stored.expiresAt.getTime() < Date.now()) {
         throw new UnauthorizedError("Refresh token expired");
      }

      const tokenPair = await this.issueTokens({
         uid: claims.sub,
         sessionId: stored.sessionId,
         clientType: stored.clientType,
         userAgent: overrides.userAgent,
         deviceId: overrides.deviceId ?? stored.deviceId,
         ipAddress: overrides.ipAddress,
      });

      await SessionToken.updateOne(
         { _id: stored._id },
         {
            $set: {
               revokedAt: new Date(),
               revokedReason: "rotated",
               lastUsedAt: new Date(),
               replacedByTokenId: tokenPair.refreshTokenId,
            },
         }
      );

      return tokenPair;
   }

   static async revokeRefreshToken(
      refreshToken: string,
      reason: string = "logout"
   ): Promise<void> {
      if (!refreshToken) {
         return;
      }

      try {
         const hashed = hashToken(refreshToken);
         await SessionToken.updateOne(
            { refreshTokenHash: hashed },
            { $set: { revokedAt: new Date(), revokedReason: reason } }
         );
      } catch (error) {
         logger.warn("Failed to revoke refresh token", { error });
      }
   }

   static verifyAccessToken(token: string): {
      uid: string;
      sessionId: string;
      tokenId?: string;
      expiresAt: Date;
   } {
      if (!token) {
         throw new UnauthorizedError("Missing authorization token");
      }

      try {
         const payload = jwt.verify(token, ACCESS_TOKEN_SECRET, {
            issuer: TOKEN_ISSUER,
            audience: TOKEN_AUDIENCE,
         }) as AccessTokenClaims;

         if (!payload.sub || !payload.sid) {
            throw new UnauthorizedError("Token missing required claims");
         }

         return {
            uid: payload.sub,
            sessionId: payload.sid,
            tokenId: payload.tid,
            expiresAt: new Date((payload.exp ?? 0) * 1000),
         };
      } catch (error) {
         logger.warn("Access token verification failed", { error });
         throw new UnauthorizedError("Invalid token");
      }
   }

   private static async issueTokens(
      metadata: TokenIssueMetadata & { sessionId: string }
   ): Promise<TokenPair> {
      // Use a single tokenId across the pair so access tokens can be traced
      const tokenId = randomUUID();
      const refreshTokenPayload = await this.signAndStoreRefreshToken(
         metadata,
         tokenId
      );
      const accessToken = this.signAccessToken(
         metadata.uid,
         metadata.sessionId,
         tokenId
      );

      logger.info("Session tokens issued", {
         userId: metadata.uid,
         sessionId: metadata.sessionId,
         clientType: metadata.clientType,
      });

      return {
         sessionId: metadata.sessionId,
         userId: metadata.uid,
         accessToken,
         accessTokenExpiresAt: new Date(
            Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000
         ),
         refreshToken: refreshTokenPayload.token,
         refreshTokenExpiresAt: refreshTokenPayload.expiresAt,
         refreshTokenId: refreshTokenPayload.tokenId,
      };
   }

   private static signAccessToken(
      uid: string,
      sessionId: string,
      tokenId: string
   ): string {
      return jwt.sign(
         {
            sub: uid,
            sid: sessionId,
            tid: tokenId,
         },
         ACCESS_TOKEN_SECRET,
         {
            expiresIn: ACCESS_TOKEN_TTL_SECONDS,
            issuer: TOKEN_ISSUER,
            audience: TOKEN_AUDIENCE,
            algorithm: "HS256",
         }
      );
   }

   private static async signAndStoreRefreshToken(
      metadata: TokenIssueMetadata & { sessionId: string },
      tokenId: string
   ): Promise<{ token: string; tokenId: string; expiresAt: Date }> {
      const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000);
      const token = jwt.sign(
         {
            sub: metadata.uid,
            sid: metadata.sessionId,
            jti: tokenId,
         },
         REFRESH_TOKEN_SECRET,
         {
            expiresIn: REFRESH_TOKEN_TTL_SECONDS,
            issuer: TOKEN_ISSUER,
            audience: TOKEN_AUDIENCE,
            algorithm: "HS256",
         }
      );

      await SessionToken.create({
         sessionId: metadata.sessionId,
         userId: metadata.uid,
         tokenId,
         clientType: metadata.clientType,
         refreshTokenHash: hashToken(token),
         expiresAt,
         ipAddress: metadata.ipAddress,
         userAgent: metadata.userAgent,
         deviceId: metadata.deviceId,
         lastUsedAt: new Date(),
      });

      return { token, tokenId, expiresAt };
   }
}
