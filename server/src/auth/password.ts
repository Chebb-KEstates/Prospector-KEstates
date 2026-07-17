import { randomBytes, scrypt as _scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scrypt = promisify(_scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * Password hashing with scrypt.
 *
 * scrypt is a memory-hard KDF built into Node's crypto module — no native
 * compilation, nothing to go stale in a lockfile, and it's the KDF Node itself
 * recommends when you don't want an argon2/bcrypt native dependency. Parameters
 * below are the current OWASP-suggested scrypt floor (N=2^17, r=8, p=1).
 *
 * Stored format: `scrypt$N$r$p$<salt-b64>$<hash-b64>` — self-describing, so raising
 * the cost later doesn't invalidate existing hashes (verify reads the row's own
 * parameters; `needsRehash` tells you when to upgrade on next successful login).
 */
const PARAMS = { N: 1 << 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const KEYLEN = 64;
const SALT_BYTES = 16;

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await scrypt(plain.normalize('NFKC'), salt, KEYLEN, PARAMS);
  return [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('base64'),
    hash.toString('base64'),
  ].join('$');
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const N = parseInt(parts[1], 10);
    const r = parseInt(parts[2], 10);
    const p = parseInt(parts[3], 10);
    const salt = Buffer.from(parts[4], 'base64');
    const expected = Buffer.from(parts[5], 'base64');
    if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

    const actual = await scrypt(plain.normalize('NFKC'), salt, expected.length, {
      N, r, p, maxmem: PARAMS.maxmem,
    });
    // Lengths are equal by construction, but timingSafeEqual throws if they differ.
    if (actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** True when a stored hash was made with weaker parameters than we now use. */
export function needsRehash(stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return true;
  return parseInt(parts[1], 10) < PARAMS.N;
}

/**
 * Password policy. Deliberately length-first rather than a composition rulebook:
 * long passphrases beat mandatory punctuation. Managers set a colleague's first
 * password, so the floor has to be meaningful.
 */
export interface PasswordProblem { message: string; }

export function validatePassword(plain: string): PasswordProblem | null {
  if (typeof plain !== 'string' || plain.length < 10) {
    return { message: 'Password must be at least 10 characters.' };
  }
  if (plain.length > 200) {
    return { message: 'Password must be 200 characters or fewer.' };
  }
  if (/^\s|\s$/.test(plain)) {
    return { message: 'Password must not start or end with a space.' };
  }
  const weak = new Set([
    'password12', 'password123', '1234567890', 'qwertyuiop',
    'demo1234!!', 'prospector', 'letmein123', 'changeme12',
  ]);
  if (weak.has(plain.toLowerCase())) {
    return { message: 'That password is too common. Choose something else.' };
  }
  return null;
}
