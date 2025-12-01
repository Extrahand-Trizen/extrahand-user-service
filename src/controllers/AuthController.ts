import { Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { AuthService } from '../services/AuthService';
import { SignupRequest, LoginRequest } from '../types';

export class AuthController {
  /**
   * POST /api/v1/auth/signup
   */
  static async signup(req: AuthenticatedRequest, res: Response): Promise<void> {
    const data: SignupRequest = req.body;
    const result = await AuthService.signup(data);
    
    res.json({
      uid: result.uid,
      email: result.email,
      emailVerified: result.emailVerified,
      emailVerificationLink: result.emailVerificationLink,
      message: result.message
    });
  }

  /**
   * POST /api/v1/auth/login
   */
  static async login(req: AuthenticatedRequest, res: Response): Promise<void> {
    const data: LoginRequest = req.body;
    const result = await AuthService.login(data);
    
    res.json(result);
  }

  /**
   * POST /api/v1/auth/password/reset
   */
  static async passwordReset(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { email, continueUrl } = req.body;
    const resetLink = await AuthService.generatePasswordResetLink(email, continueUrl);
    
    res.json({ email, resetLink });
  }

  /**
   * POST /api/v1/auth/check-phone
   */
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

