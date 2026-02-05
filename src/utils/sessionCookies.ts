import { Response, Request } from "express";
import { validateEnv } from "../config/env";

const env = validateEnv();
// Use SameSite=None; Secure so cookies are sent on cross-origin requests (e.g. frontend
// localhost:4000 → API localhost:5000). Browsers treat localhost as secure.
const secure = true;
const sameSite: "lax" | "none" = "none";
export const REFRESH_COOKIE_NAME = env.REFRESH_TOKEN_COOKIE_NAME;
export const ACCESS_COOKIE_NAME =
   env.ACCESS_TOKEN_COOKIE_NAME || "accessToken";

export function extractAccessToken(req: Request): string | undefined {
   const cookieToken = (req.cookies && req.cookies[ACCESS_COOKIE_NAME]) as
      | string
      | undefined;
   const headerToken = req.headers["x-access-token"] as string | undefined;
   const bodyToken = (req.body && req.body.accessToken) as string | undefined;
   return cookieToken || headerToken || bodyToken;
}

export function setRefreshTokenCookie(
   res: Response,
   token: string,
   expiresAt: Date
): void {
   res.cookie(REFRESH_COOKIE_NAME, token, {
      httpOnly: true,
      secure,
      sameSite,
      expires: expiresAt,
      path: "/",
      domain: env.SESSION_COOKIE_DOMAIN || undefined,
   });
}

export function setAccessTokenCookie(
   res: Response,
   token: string,
   expiresAt: Date
): void {
   res.cookie(ACCESS_COOKIE_NAME, token, {
      httpOnly: true,
      secure,
      sameSite,
      expires: expiresAt,
      path: "/",
      domain: env.SESSION_COOKIE_DOMAIN || undefined,
   });
}

export function clearRefreshTokenCookie(res: Response): void {
   res.cookie(REFRESH_COOKIE_NAME, "", {
      httpOnly: true,
      secure,
      sameSite,
      expires: new Date(0),
      path: "/",
      domain: env.SESSION_COOKIE_DOMAIN || undefined,
   });
}

export function clearAccessTokenCookie(res: Response): void {
   res.cookie(ACCESS_COOKIE_NAME, "", {
      httpOnly: true,
      secure,
      sameSite,
      expires: new Date(0),
      path: "/",
      domain: env.SESSION_COOKIE_DOMAIN || undefined,
   });
}

export function clearAuthCookies(res: Response): void {
   clearAccessTokenCookie(res);
   clearRefreshTokenCookie(res);
}

export function extractRefreshToken(req: Request): string | undefined {
   const cookieToken = (req.cookies && req.cookies[REFRESH_COOKIE_NAME]) as
      | string
      | undefined;
   const headerToken = req.headers["x-refresh-token"] as string | undefined;
   const bodyToken = (req.body && req.body.refreshToken) as string | undefined;
   return cookieToken || headerToken || bodyToken;
}
