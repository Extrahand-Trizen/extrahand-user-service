import IssueReport, { type IssueType } from '../models/IssueReport';
import { BadRequestError } from '../errors/AppError';

const ISSUE_TYPES: IssueType[] = ['payment', 'task', 'chat', 'general'];
const METADATA_FIELDS = ['source', 'platform', 'taskId', 'paymentId', 'refundId', 'userAgent'] as const;

export interface CreateIssueReportInput {
  uid: string;
  issueType: unknown;
  issueLabel: unknown;
  pageContext: unknown;
  message: unknown;
  metadata?: unknown;
}

function requiredText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') {
    throw new BadRequestError(`${field} is required`);
  }
  const text = value.trim();
  if (!text || text.length > maxLength) {
    throw new BadRequestError(`${field} must be between 1 and ${maxLength} characters`);
  }
  return text;
}

function normalizeMetadata(value: unknown): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestError('metadata must be an object');
  }

  const source = value as Record<string, unknown>;
  const metadata: Record<string, string> = {};
  for (const field of METADATA_FIELDS) {
    const entry = source[field];
    if (entry === undefined || entry === null) continue;
    if (typeof entry !== 'string' || entry.length > 500) {
      throw new BadRequestError(`metadata.${field} must be a string of at most 500 characters`);
    }
    metadata[field] = entry.trim();
  }
  return metadata;
}

export class IssueReportService {
  static async create(input: CreateIssueReportInput) {
    const uid = requiredText(input.uid, 'User authentication', 200);
    if (typeof input.issueType !== 'string' || !ISSUE_TYPES.includes(input.issueType as IssueType)) {
      throw new BadRequestError('issueType must be payment, task, chat, or general');
    }
    const issueLabel = requiredText(input.issueLabel, 'issueLabel', 160);
    const pageContext = requiredText(input.pageContext, 'pageContext', 120);
    const message = requiredText(input.message, 'message', 2000);
    if (message.length < 5) {
      throw new BadRequestError('message must be at least 5 characters');
    }

    return IssueReport.create({
      issueType: input.issueType as IssueType,
      issueLabel,
      pageContext,
      message,
      status: 'new',
      userId: uid,
      userUid: uid,
      metadata: normalizeMetadata(input.metadata),
    });
  }
}

export default IssueReportService;
