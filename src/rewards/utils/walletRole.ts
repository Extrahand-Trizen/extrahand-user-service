/** Wallet / referral channel keys aligned with Profile roles: poster | tasker */
export type WalletRole = 'poster' | 'tasker';
export type ReferralChannel = 'poster' | 'tasker';

const POSTER_ALIASES = new Set(['poster', 'customer', 'requester']);

function normalizeRoleToken(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

/** Normalize wallet role from query/body; defaults to tasker for legacy clients. */
export function parseWalletRole(raw: unknown, defaultRole: WalletRole = 'tasker'): WalletRole {
  const token = normalizeRoleToken(raw);
  if (POSTER_ALIASES.has(token)) return 'poster';
  if (token === 'tasker' || token === 'helper' || token === 'performer') return 'tasker';
  return defaultRole;
}

/** Referral program channel (poster vs tasker signup intent). */
export function parseReferralChannel(
  raw: unknown,
  defaultChannel: ReferralChannel = 'tasker'
): ReferralChannel {
  return parseWalletRole(raw, defaultChannel);
}

export function referralChannelToWalletRole(channel: ReferralChannel): WalletRole {
  return channel;
}

/** Public URL/query values (customer | helper) — maps to poster | tasker internally. */
export type PublicReferralChannel = 'customer' | 'helper';

export function channelToPublicUrlParam(channel: ReferralChannel): PublicReferralChannel {
  return channel === 'poster' ? 'customer' : 'helper';
}

export function buildPlayStoreReferralUrl(code: string, channel: ReferralChannel): string {
  const publicChannel = channelToPublicUrlParam(channel);
  return `https://play.google.com/store/apps/details?id=com.extrahand&referral=${encodeURIComponent(code)}&channel=${publicChannel}`;
}
