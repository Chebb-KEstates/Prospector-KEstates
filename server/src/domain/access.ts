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
 * May this user LOG on a unit held by `assignedTo` — a call (answered / no
 * answer / didn't connect), its notes, or a journal update? Under open view,
 * anyone who can see it may (it doesn't change who owns it; "Take over
 * ownership" does that). Otherwise only its broker or a manager.
 */
export function canLogOnUnit(me: AppUser, assignedTo?: string | null): boolean {
  return isOpenView() || canWorkUnit(me, assignedTo);
}

/**
 * May this user MANAGE a unit held by `assignedTo` — change its stage or edit
 * its listing info? Only its broker or a manager, whatever the view mode.
 */
export function canWorkUnit(me: AppUser, assignedTo?: string | null): boolean {
  return me.isManager || (!!assignedTo && assignedTo === me.id);
}
