import { Response } from 'express';
import { AuthenticatedRequest } from '../types';
import InquiryService from '../services/InquiryService';
import logger from '../config/logger';

export class InquiryController {
  static async createInquiry(req: AuthenticatedRequest, res: Response): Promise<void> {
    const uid = req.user?.uid;
    if (!uid) {
      res.status(401).json({
        success: false,
        error: 'Unauthorized',
      });
      return;
    }

    const inquiry = await InquiryService.createInquiry({
      uid,
      full_name: req.body?.full_name,
      fullName: req.body?.fullName,
      email: req.body?.email,
      subject: req.body?.subject,
      priority: req.body?.priority,
      message: req.body?.message,
      source: req.body?.source,
    });

    logger.info('Inquiry submitted successfully', {
      uid,
      inquiryId: inquiry._id?.toString(),
      subject: inquiry.subject,
      priority: inquiry.priority,
      source: inquiry.source || 'unknown',
    });

    res.status(201).json({
      success: true,
      message: 'Inquiry submitted successfully',
      data: {
        id: inquiry._id,
        createdAt: inquiry.createdAt,
      },
    });
  }
}

export default InquiryController;
