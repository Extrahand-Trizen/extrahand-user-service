import { Request, Response, NextFunction } from 'express';
// Note: Express Request type is extended in src/types/express.d.ts

export function gatewayAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
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
