import { Request, Response, NextFunction } from 'express';
// Note: Express Request type is extended in src/types/express.d.ts

export function gatewayAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
   const devBypassEnabled =
      process.env.NODE_ENV === 'development' &&
      (process.env.ALLOW_DEV_AUTH_BYPASS === 'true' ||
         process.env.ALLOW_DEV_AUTH_BYPASS === '1');

   if (devBypassEnabled) {
      console.warn('⚠️ Dev auth bypass enabled: skipping gateway auth');
      next();
      return;
   }

   const serviceAuth = req.headers['x-service-auth'];
   const userId = req.headers['x-user-id'] as string | undefined;
   const sessionId = req.headers['x-session-id'] as string | undefined;
   
   // All requests MUST come through gateway
   if (serviceAuth !== process.env.SERVICE_AUTH_TOKEN) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
   }
   
   if (userId) {
      req.user = { uid: userId, sessionId };
   }
   next();
}
