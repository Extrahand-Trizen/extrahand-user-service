import { Request, Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { PartnerCategoryRequestService } from '../services/PartnerCategoryRequestService';

function toPartnerRequestResponse(request: any): Record<string, unknown> {
  const requester = request.requester || {};
  const partnerName = requester.name || request.partnerName || request.name;
  const partnerPhone = requester.phone || request.partnerPhone || request.phone;
  const partnerEmail = requester.email || request.partnerEmail || request.email;
  return {
    requestId: request._id?.toString() || request.requestId,
    uid: requester.uid || request.uid,
    partnerName,
    partnerPhone,
    partnerEmail,
    name: partnerName,
    phone: partnerPhone,
    email: partnerEmail,
    requestedCategory: request.requestedCategory,
    requestedSkills: request.requestedSkills || [],
    currentCategories: request.currentCategories || [],
    workAreas: request.workAreas || [],
    city: request.city || '',
    requestedAt: request.createdAt || request.requestedAt,
    status: request.status,
    ...(request.reviewNotes ? { reviewNotes: request.reviewNotes } : {}),
  };
}

export class PartnerCategoryRequestController {
  static async create(req: AuthenticatedRequest, res: Response): Promise<void> {
    const result = await PartnerCategoryRequestService.create(
      req.user!.uid,
      req.body?.categoryId,
      req.body?.requestedSkills,
    );
    res.status(201).json({ success: true, data: toPartnerRequestResponse(result) });
  }

  static async listMine(req: AuthenticatedRequest, res: Response): Promise<void> {
    const result = await PartnerCategoryRequestService.listForPartner(req.user!.uid);
    res.status(200).json({ requests: result.map(toPartnerRequestResponse) });
  }

  static async listForAdmin(req: Request, res: Response): Promise<void> {
    const result = await PartnerCategoryRequestService.listForAdmin({
      status: req.query.status as string | undefined,
      page: req.query.page === undefined ? undefined : Number(req.query.page),
      limit: req.query.limit === undefined ? undefined : Number(req.query.limit),
      search: req.query.search as string | undefined,
      requestedCategory: req.query.requestedCategory as string | undefined,
      currentCategory: req.query.currentCategory as string | undefined,
      city: req.query.city as string | undefined,
    });
    res.status(200).json({
      success: true,
      data: {
        ...result,
        items: result.items.map(toPartnerRequestResponse),
      },
    });
  }

  static async review(req: Request, res: Response): Promise<void> {
    const userId = (req as any).userId || req.headers['x-user-id'];
    if (typeof userId !== 'string' || !userId.trim()) {
      res.status(400).json({ success: false, error: 'Reviewing admin identity is required' });
      return;
    }
    const result = await PartnerCategoryRequestService.review(
      req.params.requestId,
      req.body?.status,
      userId,
      req.body?.reviewNotes,
    );
    res.status(200).json({ success: true, data: toPartnerRequestResponse(result) });
  }
}
