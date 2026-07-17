import { randomUUID, randomBytes } from 'crypto';

/**
 * Collision-safe ids.
 *
 * The reference implementation minted ids as `c-${Date.now()}` (call logs),
 * `rq-${Date.now()}` (requests) and `u-${Date.now()}` (users). Two writes in the
 * same millisecond produced the same key and one silently overwrote the other —
 * reachable from the dialer's "Save & next". Ids now carry 80 bits of entropy
 * while keeping the original human-readable prefixes, so existing rows and
 * anything that pattern-matches a prefix keep working.
 */
function suffix(): string {
  return `${Date.now().toString(36)}${randomBytes(10).toString('hex')}`;
}

export const newPropertyId = () => `p-${suffix()}`;
export const newLeadId = () => `l-${suffix()}`;
export const newCallId = () => `c-${suffix()}`;
export const newRequestId = () => `rq-${suffix()}`;
export const newDatasetId = () => `ds-${suffix()}`;
export const newUserId = () => `u-${suffix()}`;
export const newAuditId = () => `a-${suffix()}`;
export const newImportSessionId = () => `imp-${suffix()}`;

export const newUuid = () => randomUUID();
