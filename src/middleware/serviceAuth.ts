import { Request, Response, NextFunction } from 'express';
import { validateEnv } from '../config/env';

/**
 * Service-to-Service Authentication Middleware
 * Validates X-Service-Auth header for inter-service communication
 */
export function serviceAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  try {
    const env = validateEnv();
    const serviceAuthToken = env.SERVICE_AUTH_TOKEN;

    if (!serviceAuthToken) {
      res.status(500).json({
        success: false,
        error: 'Service authentication not configured'
      });
      return;
    }

    const providedToken = req.headers['x-service-auth'] as string;

    if (!providedToken) {
      res.status(401).json({
        success: false,
        error: 'Service authentication required',
        message: 'Missing X-Service-Auth header'
      });
      return;
    }

    if (providedToken !== serviceAuthToken) {
      res.status(403).json({
        success: false,
        error: 'Invalid service authentication token',
        message: 'Service authentication token mismatch'
      });
      return;
    }

    // Attach service name for logging
    const serviceName = req.headers['x-service-name'] as string;
    if (serviceName) {
      (req as any).serviceName = serviceName;
    }

    // Attach user ID from header if provided (for service-to-service calls)
    const userId = req.headers['x-user-id'] as string;
    if (userId) {
      (req as any).userId = userId;
    }

    next();
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'Service authentication error',
      message: error.message
    });
  }
}
