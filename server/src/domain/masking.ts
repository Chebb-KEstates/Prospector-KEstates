import { maskedPhone } from '../../../src/utils/format';

/**
 * Server-side phone masking — the security boundary the client version never was.
 *
 * In the reference implementation `maskedPhone()` ran in the browser over a
 * payload that already held every owner's full number: anyone with devtools
 * could read the entire vault unmasked, in bulk. That defeated the product's
 * whole purpose.
 *
 * Here the rule is inverted and enforced where it can't be bypassed: list
 * responses NEVER carry a full number. The only path to a real number is the
 * single-record reveal endpoint, which checks the daily cap and writes an audit
 * entry in the same transaction. No bulk reveal, no export.
 *
 * `maskedPhone` itself is imported from the frontend's format.ts so the mask
 * renders byte-identical to what the UI produced before.
 */

/** What a caller is allowed to see about a phone number in a list context. */
export interface MaskedPhone {
  /** e.g. "••••••1234" — safe to send anywhere. */
  masked: string;
  /** Whether a number exists at all (drives `callable` styling in the table). */
  present: boolean;
}

export function maskPhone(phone?: string | null): MaskedPhone {
  const has = phone != null && phone.length > 0;
  return {
    masked: has ? maskedPhone(phone!) : '—',
    present: has,
  };
}

/**
 * Strip every full phone number out of an owner-shaped payload.
 * Call this on the way out of any list/detail endpoint that isn't the reveal.
 */
export function maskOwner<T extends { phone?: string | null }>(
  owner: T,
): Omit<T, 'phone'> & { phone: string; phonePresent: boolean } {
  const { phone, ...rest } = owner;
  const m = maskPhone(phone);
  return { ...(rest as Omit<T, 'phone'>), phone: m.masked, phonePresent: m.present };
}
