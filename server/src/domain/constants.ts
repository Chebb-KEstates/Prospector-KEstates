/**
 * Domain constants mirrored from the frontend (`src/types/models.ts`,
 * `src/types/user.ts`). Kept as plain string unions so the API can validate
 * incoming values without importing the React app's class-based models.
 */

export const PROPERTY_STATES = ['pool', 'assigned', 'portfolio', 'cooling', 'dnc'] as const;
export type PropertyStateValue = (typeof PROPERTY_STATES)[number];

export const CALL_OUTCOMES = [
  'noAnswer', 'unreachable', 'callbackLater', 'interestedSell',
  'interestedRent', 'notInterested', 'alreadyListed', 'dnc',
] as const;
export type CallOutcomeValue = (typeof CALL_OUTCOMES)[number];

export const REQUEST_STATUSES = ['pending', 'approved', 'denied'] as const;
export type RequestStatusValue = (typeof REQUEST_STATUSES)[number];

export const DATASET_TYPES = ['register', 'transactions'] as const;
export const DATA_MODULES = ['owners', 'leads'] as const;

export const USER_ROLES = ['manager', 'broker'] as const;
export type UserRoleValue = (typeof USER_ROLES)[number];

export const PERMISSIONS = [
  'requestData', 'callOwners', 'manageData', 'assignData',
  'viewReports', 'manageUsers', 'editSettings',
] as const;
export type PermissionValue = (typeof PERMISSIONS)[number];

/** Default permission set for a role — mirrors `defaultPermissions` on the client. */
export function defaultPermissions(role: string): PermissionValue[] {
  return role === 'manager'
    ? [...PERMISSIONS]
    : ['requestData', 'callOwners'];
}
