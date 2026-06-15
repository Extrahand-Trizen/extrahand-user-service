import { Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { SupplyService } from '../services/SupplyService';
import type { CapabilityType } from '../types/supply';

export class SupplyController {
  static async getMySupply(req: AuthenticatedRequest, res: Response) {
    const uid = req.user!.uid;
    const summary = await SupplyService.getSupplySummary(uid);
    res.json({ success: true, data: summary });
  }

  static async getMyPartnerAlias(req: AuthenticatedRequest, res: Response) {
    const uid = req.user!.uid;
    const summary = await SupplyService.getSupplySummary(uid);
    res.json({
      success: true,
      data: {
        partnerStatus: summary.partnerProfile.status,
        partnerProfile: summary.partnerProfile,
        capabilities: summary.capabilities.map((c) => c.categorySlug),
        completionPercent: summary.completionPercent,
      },
    });
  }

  static async patchPartnerProfile(req: AuthenticatedRequest, res: Response) {
    const uid = req.user!.uid;
    const summary = await SupplyService.patchPartnerProfile(uid, req.body);
    res.json({ success: true, data: summary });
  }

  static async createCapability(req: AuthenticatedRequest, res: Response) {
    const uid = req.user!.uid;
    const { capabilityType, categorySlug, metadata } = req.body;
    const capability = await SupplyService.createCapability(uid, {
      capabilityType: capabilityType as CapabilityType,
      categorySlug,
      metadata,
    });
    res.status(201).json({ success: true, data: capability });
  }

  static async updateCapability(req: AuthenticatedRequest, res: Response) {
    const uid = req.user!.uid;
    const capability = await SupplyService.updateCapability(uid, req.params.id, req.body);
    res.json({ success: true, data: capability });
  }

  static async submitApplication(req: AuthenticatedRequest, res: Response) {
    const uid = req.user!.uid;
    const result = await SupplyService.submitApplication(uid);
    res.status(201).json({ success: true, data: result });
  }

  static async listApplications(req: AuthenticatedRequest, res: Response) {
    const uid = req.user!.uid;
    const applications = await SupplyService.listApplications(uid);
    res.json({ success: true, data: applications });
  }

  static async upsertServiceArea(req: AuthenticatedRequest, res: Response) {
    const uid = req.user!.uid;
    const area = await SupplyService.upsertServiceArea(uid, req.body);
    res.json({ success: true, data: area });
  }

  static async listServiceAreas(req: AuthenticatedRequest, res: Response) {
    const uid = req.user!.uid;
    const areas = await SupplyService.listServiceAreas(uid);
    res.json({ success: true, data: areas });
  }

  static async updateAvailability(req: AuthenticatedRequest, res: Response) {
    const uid = req.user!.uid;
    const availability = await SupplyService.updateAvailability(uid, req.body);
    res.json({ success: true, data: availability });
  }

  static async createDocument(req: AuthenticatedRequest, res: Response) {
    const uid = req.user!.uid;
    const doc = await SupplyService.createDocument(uid, req.body);
    res.status(201).json({ success: true, data: doc });
  }

  static async listDocuments(req: AuthenticatedRequest, res: Response) {
    const uid = req.user!.uid;
    const documents = await SupplyService.listDocuments(uid);
    res.json({ success: true, data: documents });
  }

  static async getEligiblePartners(req: AuthenticatedRequest, res: Response) {
    const { categorySlug, capabilityType, pinCode, city, limit, requireOnline } = req.query;
    const partners = await SupplyService.findEligiblePartners({
      categorySlug: categorySlug as string | undefined,
      capabilityType: capabilityType as CapabilityType | undefined,
      pinCode: pinCode as string | undefined,
      city: city as string | undefined,
      limit: limit ? parseInt(limit as string, 10) : undefined,
      requireOnline: requireOnline === 'true',
    });
    res.json({ success: true, data: partners });
  }

  static async listPendingApplicationsAdmin(req: AuthenticatedRequest, res: Response) {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
    const result = await SupplyService.listPendingApplications(limit, page);
    res.json({ success: true, data: result });
  }

  static async approveApplication(req: AuthenticatedRequest, res: Response) {
    const reviewedBy = req.user?.uid ?? req.headers['x-user-id'] ?? 'admin';
    const result = await SupplyService.reviewApplication(
      req.params.id,
      'approve',
      reviewedBy as string,
      req.body.reviewNotes,
    );
    res.json({ success: true, data: result });
  }

  static async rejectApplication(req: AuthenticatedRequest, res: Response) {
    const reviewedBy = req.user?.uid ?? req.headers['x-user-id'] ?? 'admin';
    const result = await SupplyService.reviewApplication(
      req.params.id,
      'reject',
      reviewedBy as string,
      req.body.reviewNotes,
    );
    res.json({ success: true, data: result });
  }

  static async suspendPartner(req: AuthenticatedRequest, res: Response) {
    const suspendedBy = req.user?.uid ?? req.headers['x-user-id'] ?? 'admin';
    const result = await SupplyService.suspendPartner(
      req.params.profileId,
      suspendedBy as string,
      req.body.reason,
    );
    res.json({ success: true, data: result });
  }
}
