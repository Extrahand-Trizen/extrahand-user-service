export type GrantRecipientRole = 'referrer' | 'referee' | 'performer';

export type GrantMetadataSource =
  | 'referral_signup'
  | 'referral_welcome'
  | 'referral_task_bonus'
  | 'task_completion'
  | 'migration_credit'
  | string;

export interface GrantMetadata extends Record<string, unknown> {
  source: GrantMetadataSource;
  enrollmentId?: string;
  referralCode?: string;
  taskId?: string;
  programVersion?: number;
  description?: string;
  refereeUid?: string;
  referrerUid?: string;
}

export interface GrantSpec {
  idempotencyKey: string;
  recipientUid: string;
  walletRole?: 'poster' | 'tasker';
  coins: string;
  rupeeValue: string;
  expiresAt?: string;
  taskId?: string;
  metadata: GrantMetadata;
}

export interface GrantRule {
  grantId: string;
  recipient: GrantRecipientRole;
  trigger: 'on_enroll' | 'on_qualify' | 'on_task_payout';
  amount: {
    type: 'fixed_coins' | 'fixed_inr' | 'percent_of_platform_fee';
    value: number;
  };
}
