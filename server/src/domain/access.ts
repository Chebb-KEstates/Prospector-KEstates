import { OPEN_ACCESS } from '../../../src/config';
import type { AppUser } from '../../../src/types/user';
import { ApiError } from '../http/errors';

/**
 * Open access vs the assigned model — the server side of `OPEN_ACCESS`
 * (src/config.ts). Every route that used to ask "is this unit assigned to the
 * caller?" asks `canWorkUnit` instead, so the switch lives in one place.
 */

// Tests flip the mode to exercise both models; production never calls the setter.
let override: boolean | null = null;

export function isOpenAccess(): boolean {
  return override ?? OPEN_ACCESS;
}

/** TEST-ONLY: force a mode (null = back to the config value). */
export function setOpenAccessForTests(open: boolean | null): void {
  override = open;
}

/** May this user open / call / annotate a unit held by `assignedTo`? */
export function canWorkUnit(me: AppUser, assignedTo?: string | null): boolean {
  return isOpenAccess() || me.isManager || assignedTo === me.id;
}

/** Refuse an assignment or request action while open access is on. */
export function assertAssignmentsEnabled(): void {
  if (isOpenAccess()) {
    throw new ApiError(409, 'assignments_off',
      'Assignments are switched off — every unit is open to everyone, so there is nothing to assign or request.');
  }
}
