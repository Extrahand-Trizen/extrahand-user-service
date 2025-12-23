import { Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { UploadService } from '../services/UploadService';

export class UploadController {
  /**
   * POST /api/v1/uploads/profile-picture
   */
  static async uploadProfilePicture(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { uid } = req.user!;
    const file = (req as any).file;

    if (!file) {
      res.status(400).json({
        success: false,
        error: 'No image file provided'
      });
      return;
    }

    const result = await UploadService.uploadProfilePicture(
      uid,
      file.buffer,
      file.originalname || 'profile.jpg',
      file.mimetype
    );

    res.json({
      success: true,
      data: {
        url: result.url,
        key: result.key
      }
    });
  }

  /**
   * DELETE /api/v1/uploads/profile-picture
   */
  static async deleteProfilePicture(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { uid } = req.user!;
    await UploadService.deleteProfilePicture(uid);

    res.json({
      success: true,
      message: 'Profile picture deleted successfully'
    });
  }

  /**
   * POST /api/v1/uploads/document
   * Accepts images/PDF, returns URL/key. Does NOT write to profile/lead; caller stores URL.
   */
  static async uploadDocument(req: AuthenticatedRequest, res: Response): Promise<void> {
    const uid = req.user?.uid || 'system';
    const file = (req as any).file;
    const docType = (req.body?.docType as string) || 'document';
    const leadId = req.body?.leadId as string | undefined;

    if (!file) {
      res.status(400).json({
        success: false,
        error: 'No file provided'
      });
      return;
    }

    const result = await UploadService.uploadDocument(
      uid,
      file.buffer,
      file.originalname || 'document',
      file.mimetype,
      docType,
      leadId
    );

    res.json({
      success: true,
      data: {
        url: result.url,
        key: result.key
      }
    });
  }
}


