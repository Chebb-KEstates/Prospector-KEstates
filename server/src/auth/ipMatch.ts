/**
 * Office-network IP matching — pure, no I/O, so it's cheap to run on every
 * request and easy to test.
 *
 * The "office IP" setting accepts a comma-separated list, each entry either an
 * exact address or an IPv4 CIDR range (e.g. "203.0.113.10, 203.0.113.0/24, ::1").
 * A caller is allowed if it matches ANY entry. An empty list allows everyone —
 * the caller (the auth hook) also refuses to lock when the list is empty, so a
 * lock enabled with no address configured can never strand the whole team.
 */

/** Normalise for comparison: trim, lowercase, unwrap IPv4-mapped IPv6. */
export function normalizeIp(ip: string): string {
  let s = (ip || '').trim().toLowerCase();
  if (s.startsWith('::ffff:')) s = s.slice('::ffff:'.length);
  return s;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const b = Number(p);
    if (b > 255) return null;
    n = (n << 8) | b;
  }
  return n >>> 0;
}

function matchEntry(ip: string, entry: string): boolean {
  const e = normalizeIp(entry);
  if (e.length === 0) return false;
  if (e.includes('/')) {
    const [net, bitsStr] = e.split('/');
    const bits = Number(bitsStr);
    const a = ipv4ToInt(ip);
    const b = ipv4ToInt(net);
    if (a == null || b == null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (a & mask) === (b & mask);
  }
  return ip === e;
}

/** True if `clientIp` matches any entry in the comma-separated `allowList`. */
export function ipAllowed(clientIp: string, allowList: string): boolean {
  const entries = (allowList || '').split(',').map(s => s.trim()).filter(Boolean);
  if (entries.length === 0) return true; // nothing configured ⇒ don't lock
  const ip = normalizeIp(clientIp);
  return entries.some(e => matchEntry(ip, e));
}
