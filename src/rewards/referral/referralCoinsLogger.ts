import logger from '../../config/logger';

/** Grep-friendly tag: share logs containing this string when debugging signup referral coins. */
export const REFERRAL_COINS_LOG_TAG = '[REFERRAL_COINS]';

export type ReferralCoinsStep =
  | 'gateway_otp_complete_received'
  | 'signup_background_scheduled'
  | 'signup_apply_start'
  | 'signup_apply_skip_empty_code'
  | 'signup_apply_skip_invalid_format'
  | 'signup_apply_existing_enrollment'
  | 'signup_apply_reissue'
  | 'signup_apply_success'
  | 'signup_apply_error'
  | 'signup_background_finished'
  | 'orchestrator_apply_start'
  | 'orchestrator_referrer_resolved'
  | 'orchestrator_enrollment_created'
  | 'orchestrator_pipeline_start'
  | 'orchestrator_pipeline_done'
  | 'orchestrator_apply_error'
  | 'pipeline_event_start'
  | 'pipeline_event_done'
  | 'pipeline_event_error'
  | 'qualification_evaluated'
  | 'qualification_no_enrollment'
  | 'qualification_no_grants'
  | 'qualification_mark_qualified'
  | 'publisher_issue_start'
  | 'publisher_issue_done'
  | 'publisher_issue_partial'
  | 'payment_client_issue_start'
  | 'payment_client_issue_done'
  | 'payment_client_issue_error'
  | 'reissue_start'
  | 'reissue_done'
  | 'api_apply_request'
  | 'api_apply_response'
  | 'api_retry_grants_request'
  | 'api_retry_grants_response';

function maskToken(token: string | undefined): string {
  if (!token) return '(missing)';
  const t = token.trim();
  if (t.length <= 8) return '***';
  return `${t.slice(0, 4)}…${t.slice(-4)} (len=${t.length})`;
}

/** One-line console + JSON file log so winston "simple" format still shows full context. */
export function logReferralCoins(
  step: ReferralCoinsStep,
  payload: Record<string, unknown>,
  level: 'info' | 'warn' | 'error' = 'info'
): void {
  const line = `${REFERRAL_COINS_LOG_TAG} step=${step} ${JSON.stringify({
    at: new Date().toISOString(),
    ...payload,
  })}`;

  if (level === 'error') {
    logger.error(line);
    return;
  }
  if (level === 'warn') {
    logger.warn(line);
    return;
  }
  logger.info(line);
}

export function referralCoinsPaymentConfig(): {
  baseURL: string;
  serviceAuthConfigured: boolean;
  serviceAuthPreview: string;
} {
  const baseURL = (process.env.PAYMENT_SERVICE_URL || 'http://localhost:4003').replace(/\/$/, '');
  const token = (process.env.SERVICE_AUTH_TOKEN || '').trim();
  return {
    baseURL,
    serviceAuthConfigured: Boolean(token),
    serviceAuthPreview: maskToken(token),
  };
}

export function summarizeGrantsForLog(
  grants: Array<{ recipientUid?: string; coins?: string; idempotencyKey?: string; metadata?: { source?: string } }>
): Array<Record<string, string>> {
  return grants.map((g) => ({
    recipientUid: String(g.recipientUid || '').slice(0, 12) + (g.recipientUid && g.recipientUid.length > 12 ? '…' : ''),
    coins: String(g.coins ?? '?'),
    source: String(g.metadata?.source ?? '?'),
    idempotencyKey: String(g.idempotencyKey ?? '?'),
  }));
}
