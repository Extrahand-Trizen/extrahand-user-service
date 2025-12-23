import { Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { AuthService } from '../services/AuthService';

export class AuthController {
  static async checkPhone(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { phone } = req.body;
    const result = await AuthService.checkPhoneExists(phone);
    
    res.json({
      success: true,
      exists: result.exists,
      phone: result.phone
    });
  }
}

