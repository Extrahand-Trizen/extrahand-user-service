import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import { validateEnv } from '../config/env';
import { extractAccessToken } from '../utils/sessionCookies';
import { SessionService } from '../services/SessionService';

/**
 * Unified auth middleware - accepts service auth from API Gateway OR JWT session tokens
 * Priority: Service auth (from API Gateway) > JWT tokens (from cookies or header)
 * For service-to-service calls, sets req.user from X-User-Id header (no verification needed)
 */
export async function authMiddleware(
   req: AuthenticatedRequest,
   res: Response,
   next: NextFunction
): Promise<void> {
  const devBypassEnabled =
    process.env.NODE_ENV === 'development' &&
    (process.env.ALLOW_DEV_AUTH_BYPASS === 'true' ||
      process.env.ALLOW_DEV_AUTH_BYPASS === '1');
  // Check for service auth first (for API Gateway calls - fast path, no token verification)
  const serviceAuthToken = req.headers['x-service-auth'] as string;
  const userId = req.headers['x-user-id'] as string;
  
  if (serviceAuthToken && userId) {
    try {
      // Validate service auth token
      const env = validateEnv();
      if (serviceAuthToken === env.SERVICE_AUTH_TOKEN) {
        // Set user from service auth - API Gateway already verified the token
        req.user = { uid: userId, token: null as any };
        next();
        return;
      } else {
        res.status(403).json({
          success: false,
          error: 'Invalid service authentication token'
        });
        return;
      }
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: 'Service authentication error',
        message: error.message
      });
      return;
    }
  }
  
  // Fall back to JWT token auth (extract from cookies OR Authorization header)
  try {
    // Try to extract JWT token from cookies first, then from Authorization header
    let jwtToken = extractAccessToken(req);
    
    // If not in cookies, try Authorization header
    if (!jwtToken) {
      const header = req.headers.authorization || '';
      const match = /^Bearer (.+)$/.exec(header);
      if (match) {
        jwtToken = match[1];
      }
    }
    
    if (!jwtToken && devBypassEnabled) {
      console.warn('⚠️ Dev auth bypass enabled: injecting dev user');
      const devUid =
        process.env.DEV_AUTH_UID || process.env.DEV_USER_UID || 'dev-user';
      req.user = { uid: devUid, token: null as any };
      next();
      return;
    }

    if (!jwtToken) {
      res.status(401).json({ 
        success: false,
        error: 'Missing access token',
        details: 'Please ensure you are logged in and your cookies or Authorization header are sent with the request'
      });
      return;
    }
    
    // Verify JWT token using SessionService (NOT Firebase!)
    const verified = SessionService.verifyAccessToken(jwtToken);
    
    // Set user from JWT claims
    req.user = { uid: verified.uid, token: jwtToken };
    next();
  } catch (e: any) {
    res.status(401).json({ 
      success: false,
      error: 'Invalid or expired token',
      details: e.message
    });
    return;
  }
}

/**
 * Optional auth middleware - sets req.user if token is present, but doesn't require it
 * Used for routes that work with or without authentication
 */
export async function optionalAuthMiddleware(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const devBypassEnabled =
    process.env.NODE_ENV === 'development' &&
    (process.env.ALLOW_DEV_AUTH_BYPASS === 'true' ||
      process.env.ALLOW_DEV_AUTH_BYPASS === '1');
  // Check for service auth first
  const serviceAuthToken = req.headers['x-service-auth'] as string;
  const userId = req.headers['x-user-id'] as string;
  
  if (serviceAuthToken && userId) {
    try {
      const env = validateEnv();
      if (serviceAuthToken === env.SERVICE_AUTH_TOKEN) {
        req.user = { uid: userId, token: null as any };
        next();
        return;
      }
    } catch (error) {
      // Continue to JWT check
    }
  }
  
  // Fall back to JWT token auth (extract from cookies OR Authorization header)
  // Try to extract token from cookies first, then from Authorization header
  let jwtToken = extractAccessToken(req);
  
  // If not in cookies, try Authorization header
  if (!jwtToken) {
    const header = req.headers.authorization || '';
    const match = /^Bearer (.+)$/.exec(header);
    if (match) {
      jwtToken = match[1];
    }
  }
  
  if (jwtToken) {
    try {
      // Verify JWT token using SessionService (NOT Firebase!)
      const verified = SessionService.verifyAccessToken(jwtToken);
      req.user = { uid: verified.uid, token: jwtToken };
    } catch (e) {
      req.user = undefined;
    }
  } else if (devBypassEnabled) {
    console.warn('⚠️ Dev auth bypass enabled: injecting dev user (optional auth)');
    const devUid =
      process.env.DEV_AUTH_UID || process.env.DEV_USER_UID || 'dev-user';
    req.user = { uid: devUid, token: null as any };
  } else {
    req.user = undefined;
  }
  
  next();
}
