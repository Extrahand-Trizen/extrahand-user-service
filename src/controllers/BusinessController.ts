import { Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { BusinessService } from '../services/BusinessService';
import { validateEnv } from '../config/env';

const env = validateEnv();

export class BusinessController {
  /**
   * POST /api/v1/business/details
   */
  static async saveBusinessDetails(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { uid } = req.user!;
    const businessData = req.body;

    await BusinessService.saveBusinessDetails(uid, businessData);

    res.json({
      success: true,
      message: 'Business details saved successfully'
    });
  }

  /**
   * POST /api/v1/business/pan/verify
   */
  static async verifyPAN(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { uid } = req.user!;
    const { panNumber, consent } = req.body;

    const result = await BusinessService.verifyBusinessPAN(
      uid,
      panNumber,
      consent,
      env.VERIFICATION_SERVICE_URL,
      env.SERVICE_AUTH_TOKEN || ''
    );

    res.json(result);
  }

  /**
   * POST /api/v1/business/bank/verify
   */
  static async verifyBank(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { uid } = req.user!;
    const { accountNumber, ifsc, accountHolderName, consent } = req.body;

    const result = await BusinessService.verifyBusinessBank(
      uid,
      accountNumber,
      ifsc,
      accountHolderName,
      consent,
      env.VERIFICATION_SERVICE_URL,
      env.SERVICE_AUTH_TOKEN || ''
    );

    res.json(result);
  }

  /**
   * POST /api/v1/business/gst/verify
   */
  static async verifyGST(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { uid } = req.user!;
    const { gstNumber } = req.body;

    const result = await BusinessService.verifyGST(uid, gstNumber);

    res.json(result);
  }

  /**
   * POST /api/v1/business/document/upload
   */
  static async uploadDocument(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { uid } = req.user!;
    const { documentType, documentUrl } = req.body;

    await BusinessService.uploadBusinessDocument(uid, documentType, documentUrl);

    res.json({
      success: true,
      message: 'Document uploaded successfully',
      data: {
        documentType,
        uploadedAt: new Date()
      }
    });
  }

  /**
   * GET /api/v1/business/status
   */
  static async getBusinessStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { uid } = req.user!;
    const data = await BusinessService.getBusinessStatus(uid);

    res.json({
      success: true,
      data
    });
  }
}


