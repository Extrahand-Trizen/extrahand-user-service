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
    fileSize: 10 * 1024 * 1024, // 10MB limit (match gateway)
  },
  fileFilter: (_req, file, cb) => {
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

// Helper to handle multer errors (avoid 500s)
const handleMulterSingle = (fieldName: string) => (req: any, res: any, next: any) => {
  upload.single(fieldName)(req, res, (err: any) => {
    if (err) {
      const message = err?.message || 'Invalid file upload';
      res.status(400).json({
        success: false,
        error: message,
      });
      return;
    }
    next();
  });
};

// POST /api/v1/uploads/profile-picture
router.post('/profile-picture', handleMulterSingle('image'), asyncHandler(UploadController.uploadProfilePicture));

// POST /api/v1/uploads/certificate
router.post('/certificate', handleMulterSingle('image'), asyncHandler(UploadController.uploadCertificate));

// DELETE /api/v1/uploads/profile-picture
router.delete('/profile-picture', asyncHandler(UploadController.deleteProfilePicture));

// POST /api/v1/uploads/document
// Accept images/PDF up to 10MB
const uploadDocument = multer({
  storage: multerMemoryStorage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only jpg/png/pdf files are allowed'));
    }
  }
});

const handleMulterDocument = (req: any, res: any, next: any) => {
  uploadDocument.single('file')(req, res, (err: any) => {
    if (err) {
      const message = err?.message || 'Invalid file upload';
      res.status(400).json({
        success: false,
        error: message,
      });
      return;
    }
    next();
  });
};

router.post('/document', handleMulterDocument, asyncHandler(UploadController.uploadDocument));

// GET /api/v1/uploads/health
// Health check for storage service (public, no auth required)
router.get('/health', asyncHandler(async (_req, res) => {
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

