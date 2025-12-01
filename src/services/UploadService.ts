import Profile from '../models/Profile';
import { NotFoundError, BadRequestError } from '../errors/AppError';
import logger from '../config/logger';
import { uploadFile, deleteFile, getStorageType } from '../utils/storageManager';

export class UploadService {
  /**
   * Upload profile picture
   */
  static async uploadProfilePicture(
    uid: string,
    fileBuffer: Buffer,
    filename: string,
    mimetype: string
  ): Promise<{ url: string; key: string }> {
    if (!fileBuffer || !filename) {
      throw new BadRequestError('No image file provided');
    }

    // Upload to storage (MinIO, S3, etc.)
    const result = await uploadFile(
      fileBuffer,
      filename,
      mimetype,
      'profile-pictures',
      {
        userId: uid,
        type: 'profile-picture'
      }
    );

    // Update profile with new photo URL
    await Profile.updateOne(
      { uid },
      {
        $set: {
          photoURL: result.url,
          updatedAt: new Date()
        }
      }
    );

    logger.info('Profile picture uploaded', {
      uid,
      url: result.url,
      key: result.key,
      provider: getStorageType()
    });

    return {
      url: result.url,
      key: result.key
    };
  }

  /**
   * Delete profile picture
   */
  static async deleteProfilePicture(uid: string): Promise<void> {
    const profile = await Profile.findOne({ uid });
    if (!profile || !profile.photoURL) {
      throw new NotFoundError('No profile picture found');
    }

    // Extract key from URL
    const urlParts = profile.photoURL.split('/');
    const keyIndex = urlParts.findIndex((part: string) => 
      part.includes('profile-pictures') || part.includes('extrahand-images')
    );

    let key: string;
    if (keyIndex === -1) {
      // Fallback: try to extract from last parts
      key = urlParts.slice(-2).join('/');
    } else {
      key = urlParts.slice(keyIndex).join('/');
    }
    
    await deleteFile(key);

    // Update profile
    await Profile.updateOne(
      { uid },
      {
        $set: {
          photoURL: null,
          updatedAt: new Date()
        }
      }
    );

    logger.info('Profile picture deleted', {
      uid,
      provider: getStorageType()
    });
  }
}

