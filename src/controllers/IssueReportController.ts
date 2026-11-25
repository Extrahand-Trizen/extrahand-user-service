import { Response } from 'express';
import { AuthenticatedRequest } from '../types';
import IssueReportService from '../services/IssueReportService';
import logger from '../config/logger';
import mongoose from 'mongoose';

export class IssueReportController {
  static async create(req: AuthenticatedRequest, res: Response): Promise<void> {
    const uid = req.user?.uid;
    if (!uid) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const report = await IssueReportService.create({
      uid,
      issueType: req.body?.issueType,
      issueLabel: req.body?.issueLabel,
      pageContext: req.body?.pageContext,
      message: req.body?.message,
      metadata: req.body?.metadata,
    });

    logger.info('Customer support ticket submitted', {
      uid,
      ticketId: report._id.toString(),
      issueType: report.issueType,
    });

    res.status(201).json({
      success: true,
      message: 'Support ticket submitted successfully',
      data: { id: report._id, createdAt: report.createdAt },
    });
  }

  static async listMine(req: AuthenticatedRequest, res: Response): Promise<void> {
    const uid = req.user?.uid;
    if (!uid) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const collection = mongoose.connection.collection('issuereports');
    const filter = { $or: [{ userUid: uid }, { userId: uid }] };
    const [total, reports] = await Promise.all([
      collection.countDocuments(filter),
      collection
        .find(filter, {
          projection: {
            issueType: 1,
            issueLabel: 1,
            pageContext: 1,
            message: 1,
            status: 1,
            replies: 1,
            createdAt: 1,
            updatedAt: 1,
          },
        })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .toArray(),
    ]);

    res.json({
      success: true,
      data: reports.map((report) => ({
        _id: String(report._id),
        issueType: report.issueType,
        subject: report.issueLabel || 'Customer support request',
        pageContext: report.pageContext,
        message: report.message || '',
        status: report.status === 'open' || !report.status ? 'new' : report.status,
        replies: Array.isArray(report.replies) ? report.replies : [],
        createdAt: report.createdAt,
        updatedAt: report.updatedAt,
      })),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  }
}

export default IssueReportController;
