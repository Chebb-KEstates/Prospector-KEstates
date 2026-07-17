import { pool, closePool } from './pool';
import { hashPassword } from '../auth/password';

/**
 * Reset the demo accounts to known credentials.
 *
 * Development-only, and it exists because the data is real now: an end-to-end
 * run that exercises the forced-password-change flow actually changes the
 * password, so the next run can't sign in with the old one. That statefulness is
 * the migration working as intended — this just gives the browser suite a
 * deterministic starting point.
 *
 * Refuses to run in production: it would set known passwords on live accounts.
 */
const DEMO: { email: string; password: string }[] = [
  { email: 'director@demo.ae', password: 'ChangeMe_demo1234' },
  { email: 'sara@demo.ae', password: 'demo1234' },
  { email: 'omar@demo.ae', password: 'demo1234' },
];

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to reset demo passwords in production.');
  }

  for (const d of DEMO) {
    const hash = await hashPassword(d.password);
    const [res] = await pool.query(
      `UPDATE users SET password_hash = ?, must_change_password = 1, active = 1
       WHERE email = ?`,
      [hash, d.email],
    );
    const n = (res as { affectedRows?: number }).affectedRows ?? 0;
    console.log(n > 0 ? `  reset ${d.email}` : `  (no account ${d.email})`);
  }
  // Clear sessions so nothing survives with the old credentials.
  await pool.query(
    `DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email IN (?, ?, ?))`,
    DEMO.map(d => d.email),
  );
  console.log('Demo passwords reset (all must change on next sign-in).');
}

main()
  .then(async () => { await closePool(); process.exit(0); })
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await closePool().catch(() => {});
    process.exit(1);
  });
