import test from 'node:test';
import assert from 'node:assert/strict';
import { pool, closePool } from '../src/db/pool';
import { createSession, readSession, revokeSession, sweepExpiredSessions } from '../src/auth/sessions';

/**
 * Session lifetime is a timezone-frame problem.
 *
 * `createSession` binds a JS Date and the pool is opened with `timezone: 'Z'`,
 * so `expires_at` holds UTC wall-clock. MySQL's NOW(3) answers in the *session*
 * zone (UTC+4 on the Dubai box and the dev Macs), so the original
 * `expires_at > NOW(3)` retired every session a whole UTC offset before its TTL
 * was up — signing people out four hours early — and `sweepExpiredSessions`
 * then deleted the row for good. Nothing re-checked either in JS.
 *
 * These tests calibrate against the box they run on: a session expiring less
 * than one local offset from now is still live under UTC_TIMESTAMP(3) and
 * already dead under NOW(3). On a box running UTC there is no offset to
 * exploit, so they degrade to asserting the plain invariant.
 */

const kUserId = 'u-director';

async function sessionSkewSeconds(): Promise<number> {
  const [rows] = await pool.query<any[]>(
    'SELECT TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(3), NOW(3)) AS skew',
  );
  return Number(rows[0].skew);
}

/** Force one session's deadline to `ms` from now, in the UTC frame the app uses. */
async function setExpiry(token: string, ms: number): Promise<void> {
  const { createHash } = await import('crypto');
  const hash = createHash('sha256').update(token, 'utf8').digest();
  await pool.query('UPDATE sessions SET expires_at = ? WHERE token_hash = ?',
    [new Date(Date.now() + ms), hash]);
}

test('a session inside its TTL survives — the deadline is read in UTC', async () => {
  const skew = await sessionSkewSeconds();
  // Comfortably live, but inside the window NOW(3) would have called expired.
  const aliveForMs = skew > 0 ? (skew * 1000) / 2 : 3600_000;

  const { token } = await createSession(kUserId, { userAgent: 'test', ip: '127.0.0.1' });
  await setExpiry(token, aliveForMs);

  const found = await readSession(token);
  assert.ok(found, 'session with time left on the clock must still resolve');
  assert.equal(found.userId, kUserId);

  await revokeSession(token);
});

test('sweepExpiredSessions only deletes sessions that are actually past their deadline', async () => {
  const skew = await sessionSkewSeconds();
  const aliveForMs = skew > 0 ? (skew * 1000) / 2 : 3600_000;

  const live = await createSession(kUserId, {});
  await setExpiry(live.token, aliveForMs);

  const dead = await createSession(kUserId, {});
  await setExpiry(dead.token, -60_000);

  await sweepExpiredSessions();

  assert.ok(await readSession(live.token), 'a session with time left must survive the sweep');
  assert.equal(await readSession(dead.token), null, 'a genuinely expired session is gone');

  await revokeSession(live.token);
});

test('an expired session reads as absent', async () => {
  const { token } = await createSession(kUserId, {});
  await setExpiry(token, -60_000);
  assert.equal(await readSession(token), null);
  await revokeSession(token);
});

test.after(async () => {
  await pool.query('DELETE FROM sessions WHERE user_id = ?', [kUserId]);
  await closePool();
});
