import { Response, NextFunction } from 'express';
import { auth } from '../config/firebase';
import { AuthenticatedRequest } from '../types';
import { validateEnv } from '../config/env';

/**
 * Unified auth middleware - accepts service auth from API Gateway OR Firebase token
 * Priority: Service auth (from API Gateway) > Firebase token (direct client calls)
 * For service-to-service calls, sets req.user from X-User-Id header (no Firebase verification needed)
 */
export async function authMiddleware(
   req: AuthenticatedRequest,
   res: Response,
   next: NextFunction
): Promise<void> {
  // Check for service auth first (for API Gateway calls - fast path, no Firebase verification)
  const serviceAuthToken = req.headers['x-service-auth'] as string;
  const userId = req.headers['x-user-id'] as string;
  
  if (serviceAuthToken && userId) {
    try {
      // Validate service auth token
      const env = validateEnv();
      if (serviceAuthToken === env.SERVICE_AUTH_TOKEN) {
        // Set user from service auth - API Gateway already verified the Firebase token
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
  
  // Fall back to Firebase token auth (for direct client calls or edge cases)
  try {
    const header = req.headers.authorization || '';
    const match = /^Bearer (.+)$/.exec(header);
    
    if (!match) {
      res.status(401).json({ error: 'Missing Authorization header' });
      return;
    }
    
    const idToken = match[1];
    const decoded = await auth.verifyIdToken(idToken);
    // Store the raw ID token string on req.user.token (type: string)
    // and use the decoded token only to extract the uid.
    req.user = { uid: decoded.uid, token: idToken };
    next();
  } catch (e) {
    res.status(401).json({ error: 'Invalid token' });
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
      // Continue to Firebase check
    }
  }
  
  // Fall back to Firebase token auth (optional)
  const header = req.headers.authorization || '';
  const match = /^Bearer (.+)$/.exec(header);
  
    if (match) {
      try {
        const idToken = match[1];
        const decoded = await auth.verifyIdToken(idToken);
        // Same convention: keep uid from decoded token, store raw token string
        req.user = { uid: decoded.uid, token: idToken };
      } catch (e) {
        req.user = undefined;
      }
    } else {
      req.user = undefined;
    }
  
  next();
}
