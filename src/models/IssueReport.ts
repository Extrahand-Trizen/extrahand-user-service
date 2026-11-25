import mongoose, { Schema, type Model, type Types } from 'mongoose';

export type IssueType = 'payment' | 'task' | 'chat' | 'general';
export type IssueStatus = 'new' | 'read' | 'replied' | 'closed';

export interface IIssueReport {
  _id: Types.ObjectId;
  issueType: IssueType;
  issueLabel: string;
  pageContext: string;
  message: string;
  status: IssueStatus;
  userId: string;
  userUid: string;
  metadata?: Record<string, string>;
  replies?: Array<{
    message: string;
    repliedBy?: string;
    createdAt: Date;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

const issueReportSchema = new Schema<IIssueReport>(
  {
    issueType: {
      type: String,
      enum: ['payment', 'task', 'chat', 'general'],
      required: true,
    },
    issueLabel: { type: String, required: true, trim: true, maxlength: 160 },
    pageContext: { type: String, required: true, trim: true, maxlength: 120 },
    message: { type: String, required: true, trim: true, minlength: 5, maxlength: 2000 },
    status: {
      type: String,
      enum: ['new', 'read', 'replied', 'closed'],
      default: 'new',
    },
    userId: { type: String, required: true, trim: true, index: true },
    userUid: { type: String, required: true, trim: true, index: true },
    metadata: { type: Schema.Types.Mixed },
    replies: [
      {
        message: { type: String, required: true, trim: true, maxlength: 2000 },
        repliedBy: { type: String, trim: true },
        createdAt: { type: Date, required: true },
      },
    ],
  },
  { timestamps: true, collection: 'issuereports' },
);

const IssueReport: Model<IIssueReport> =
  (mongoose.models.IssueReport as Model<IIssueReport>) ||
  mongoose.model<IIssueReport>('IssueReport', issueReportSchema);

export default IssueReport;
