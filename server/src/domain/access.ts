import { OPEN_VIEW } from '../../../src/config';
import type { AppUser } from '../../../src/types/user';

/**
 * Who may SEE a unit and who may WORK it — the server side of `OPEN_VIEW`
 * (src/config.ts). Routes ask these two questions instead of comparing
 * `assignedTo` themselves, so the rule lives in one place.
 */

// Tests flip the mode to exercise both; production never calls the setter.
let override: boolean | null = null;

export function isOpenView(): boolean {
  return override ?? OPEN_VIEW;
}

/** TEST-ONLY: force a mode (null = back to the config value). */
export function setOpenViewForTests(open: boolean | null): void {
  override = open;
}

/** May this user open / read a unit held by `assignedTo` (its record, owner, number, history)? */
export function canViewUnit(me: AppUser, assignedTo?: string | null): boolean {
  return isOpenView() || canWorkUnit(me, assignedTo);
}

/**
 * May this user WORK a unit held by `assignedTo` — log a call, write notes or an
 * update, edit listing info, change the stage? Only its broker or a manager,
 * whatever the view mode.
 */
export function canWorkUnit(me: AppUser, assignedTo?: string | null): boolean {
  return me.isManager || (!!assignedTo && assignedTo === me.id);
}
