import { Router } from 'express';
import multer from 'multer';
import { UploadController } from '../controllers/UploadController';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

// Configure multer for memory storage
const multerMemoryStorage = multer.memoryStorage();
const upload = multer({
  storage: multerMemoryStorage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept only images
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// All upload routes require authentication
router.use(authMiddleware);

// POST /api/v1/uploads/profile-picture
router.post('/profile-picture', upload.single('image'), asyncHandler(UploadController.uploadProfilePicture));

// DELETE /api/v1/uploads/profile-picture
router.delete('/profile-picture', asyncHandler(UploadController.deleteProfilePicture));

// GET /api/v1/uploads/health
// Health check for storage service (public, no auth required)
router.get('/health', asyncHandler(async (req, res) => {
  const { healthCheck, getStorageType } = await import('../utils/storageManager');
  const isHealthy = await healthCheck();
  const provider = getStorageType();
  
  res.json({
    success: true,
    data: {
      provider,
      healthy: isHealthy,
      timestamp: new Date().toISOString()
    }
  });
}));

export default router;

