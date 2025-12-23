import { Response, NextFunction } from 'express';
import { auth } from '../config/firebase';
import { AuthenticatedRequest } from '../types';
import { validateEnv } from '../config/env';

export async function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const header = req.headers.authorization || '';
    const match = /^Bearer (.+)$/.exec(header);
    
    if (!match) {
      res.status(401).json({ error: 'Missing Authorization header' });
      return;
    }
    
    const idToken = match[1];
    const token = await auth.verifyIdToken(idToken);
    req.user = { uid: token.uid, token };
    next();
  } catch (e) {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }
}

// Optional auth middleware - sets req.user if token is present, but doesn't require it
export async function optionalAuthMiddleware(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const header = req.headers.authorization || '';
  const match = /^Bearer (.+)$/.exec(header);
  
  if (match) {
    try {
      const idToken = match[1];
      const token = await auth.verifyIdToken(idToken);
      req.user = { uid: token.uid, token };
    } catch (e) {
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
  const serviceAuthToken = req.headers['x-service-auth'] as string;
  const userId = req.headers['x-user-id'] as string;
  
  if (serviceAuthToken && userId) {
    try {
      // Validate service auth token
      const env = validateEnv();
      if (serviceAuthToken === env.SERVICE_AUTH_TOKEN) {
        // Set user from service auth - this allows the controller to work
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
  
  // Fall back to Firebase token auth
  try {
    const header = req.headers.authorization || '';
    const match = /^Bearer (.+)$/.exec(header);
    
    if (!match) {
      res.status(401).json({ error: 'Missing Authorization header' });
      return;
    }
    
    const idToken = match[1];
    const token = await auth.verifyIdToken(idToken);
    req.user = { uid: token.uid, token };
    next();
  } catch (e) {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }
}
