export type AccountDeletionMode = 'full' | 'roleScoped';

function normalizeRoles(rawRoles: unknown): string[] {
  if (!Array.isArray(rawRoles)) return [];
  return rawRoles
    .map((role) => String(role || '').trim().toLowerCase())
    .filter(Boolean);
}

export function getAccountDeletionMode(profileRoles: unknown): AccountDeletionMode {
  const roles = normalizeRoles(profileRoles);
  const hasPosterRole = roles.some((role) => ['poster', 'requester', 'customer', 'both'].includes(role));
  const hasHelperOrPartnerRole = roles.some((role) => ['tasker', 'performer', 'helper', 'partner', 'both'].includes(role));

  return hasPosterRole && hasHelperOrPartnerRole ? 'roleScoped' : 'full';
}

export function getRolesAfterRemovingHelperPartner(profileRoles: unknown): string[] {
  const roles = normalizeRoles(profileRoles);
  const hasPosterRole = roles.some((role) => ['poster', 'requester', 'customer', 'both'].includes(role));
  const remaining = hasPosterRole ? ['poster'] : [];

  return remaining;
}
