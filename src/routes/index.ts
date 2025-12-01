import { Router } from 'express';
import authRoutes from './auth';
import profileRoutes from './profiles';
import businessRoutes from './business';
import privacyRoutes from './privacy';
import uploadRoutes from './uploads';

const router = Router();

// Health check
router.get('/health', (_req, res) => {
  res.json({
    success: true,
    service: 'extrahand-user-service',
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

// API routes
router.use('/auth', authRoutes);
router.use('/profiles', profileRoutes);
router.use('/business', businessRoutes);
router.use('/privacy', privacyRoutes);
router.use('/uploads', uploadRoutes);

export default router;

