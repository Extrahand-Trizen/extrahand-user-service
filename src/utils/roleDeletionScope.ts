import type { AuthChannel } from './authChannel';

export type AccountDeletionMode = 'full' | 'roleScoped';

/** What task-service cascade should wipe for this delete request. */
export type DeletionDataScope = 'full' | 'poster-scoped' | 'helper-scoped';

export type AccountDeletionPlan = {
  mode: AccountDeletionMode;
  dataScope: DeletionDataScope;
  /** Roles to keep on the profile after a role-scoped delete. */
  remainingRoles: string[];
  /** Which product surface is being removed. */
  removeSide: 'poster' | 'helper' | 'all';
};

function normalizeRoles(rawRoles: unknown): string[] {
  if (!Array.isArray(rawRoles)) return [];
  return rawRoles
    .map((role) => String(role || '').trim().toLowerCase())
    .filter(Boolean);
}

export function profileHasPosterCapability(profileRoles: unknown): boolean {
  const roles = normalizeRoles(profileRoles);
  return roles.some((role) =>
    ['poster', 'requester', 'customer', 'both'].includes(role),
  );
}

export function profileHasHelperCapability(profileRoles: unknown): boolean {
  const roles = normalizeRoles(profileRoles);
  return roles.some((role) =>
    ['tasker', 'performer', 'helper', 'partner', 'both'].includes(role),
  );
}

/** Keep helper/partner after customer-app delete. */
export function getRolesAfterRemovingPoster(profileRoles: unknown): string[] {
  const roles = normalizeRoles(profileRoles);
  const remaining: string[] = [];
  if (
    roles.some((role) =>
      ['tasker', 'performer', 'helper', 'both'].includes(role),
    )
  ) {
    remaining.push('tasker');
  }
  if (roles.includes('partner')) {
    remaining.push('partner');
  }
  return remaining;
}

/** Keep poster after helper-app delete. */
export function getRolesAfterRemovingHelperPartner(profileRoles: unknown): string[] {
  const roles = normalizeRoles(profileRoles);
  const hasPosterRole = roles.some((role) =>
    ['poster', 'requester', 'customer', 'both'].includes(role),
  );
  return hasPosterRole ? ['poster'] : [];
}

/**
 * Resolve deletion plan from profile roles + which app initiated delete.
 *
 * - customer_app + also helper → strip poster only, wipe poster tasks
 * - helper_app + also poster → strip helper only, wipe applications
 * - single capability (or unknown channel on single role) → full account wipe
 */
export function resolveAccountDeletionPlan(
  profileRoles: unknown,
  authChannel?: AuthChannel,
): AccountDeletionPlan {
  const hasPoster = profileHasPosterCapability(profileRoles);
  const hasHelper = profileHasHelperCapability(profileRoles);

  if (authChannel === 'customer_app') {
    if (hasHelper) {
      return {
        mode: 'roleScoped',
        dataScope: 'poster-scoped',
        remainingRoles: getRolesAfterRemovingPoster(profileRoles),
        removeSide: 'poster',
      };
    }
    return {
      mode: 'full',
      dataScope: 'full',
      remainingRoles: [],
      removeSide: 'all',
    };
  }

  if (authChannel === 'helper_app') {
    if (hasPoster) {
      return {
        mode: 'roleScoped',
        dataScope: 'helper-scoped',
        remainingRoles: getRolesAfterRemovingHelperPartner(profileRoles),
        removeSide: 'helper',
      };
    }
    return {
      mode: 'full',
      dataScope: 'full',
      remainingRoles: [],
      removeSide: 'all',
    };
  }

  // Legacy / missing authChannel: dual-role kept old helper-removal behavior.
  if (hasPoster && hasHelper) {
    return {
      mode: 'roleScoped',
      dataScope: 'helper-scoped',
      remainingRoles: getRolesAfterRemovingHelperPartner(profileRoles),
      removeSide: 'helper',
    };
  }

  return {
    mode: 'full',
    dataScope: 'full',
    remainingRoles: [],
    removeSide: 'all',
  };
}

/** @deprecated Prefer resolveAccountDeletionPlan with authChannel. */
export function getAccountDeletionMode(profileRoles: unknown): AccountDeletionMode {
  return resolveAccountDeletionPlan(profileRoles).mode;
}
