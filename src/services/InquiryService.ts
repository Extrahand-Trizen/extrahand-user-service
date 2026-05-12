import Inquiry, { IInquiry, InquiryPriority } from '../models/Inquiry';
import { BadRequestError } from '../errors/AppError';

export interface CreateInquiryInput {
  uid: string;
  full_name?: string;
  fullName?: string;
  email: string;
  subject: string;
  priority?: InquiryPriority;
  message: string;
  source?: string;
}

function normalizeName(input: CreateInquiryInput): string {
  return (input.full_name || input.fullName || '').trim();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export class InquiryService {
  static async createInquiry(input: CreateInquiryInput): Promise<IInquiry> {
    const fullName = normalizeName(input);
    const email = String(input.email || '').trim().toLowerCase();
    const subject = String(input.subject || '').trim();
    const message = String(input.message || '').trim();
    const source = input.source ? String(input.source).trim() : undefined;
    const priority = (input.priority || 'medium') as InquiryPriority;

    if (!input.uid || !String(input.uid).trim()) {
      throw new BadRequestError('User authentication is required');
    }
    if (!fullName) {
      throw new BadRequestError('fullName is required');
    }
    if (!email || !isValidEmail(email)) {
      throw new BadRequestError('A valid email is required');
    }
    if (!subject) {
      throw new BadRequestError('subject is required');
    }
    if (!message) {
      throw new BadRequestError('message is required');
    }
    if (!['low', 'medium', 'high', 'urgent'].includes(priority)) {
      throw new BadRequestError('priority must be one of: low, medium, high, urgent');
    }

    return Inquiry.create({
      uid: input.uid.trim(),
      fullName,
      email,
      subject,
      priority,
      message,
      source,
    });
  }
}

export default InquiryService;
