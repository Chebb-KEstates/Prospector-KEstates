import { buildApp } from './app';
import { env } from './config/env';
import { pool, closePool } from './db/pool';
import { sweepExpiredSessions } from './auth/sessions';
import { sweepExpiredImports } from './repositories/importRepo';
import { sweepLapsed } from './services/callService';

/**
 * Entry point.
 *
 * Note the housekeeping timers. The client used to run the cooldown sweep on
 * every vault load, which meant a unit only left "cooling" when somebody
 * happened to open the app. Server-side it happens on a schedule for everyone
 * at once — same shared `sweepCooldowns`, just no longer dependent on a human
 * being logged in.
 */
const SWEEP_INTERVAL_MS = 15 * 60_000;

async function main() {
  const app = await buildApp();

  // Fail fast and loudly if the database isn't reachable — a server that boots
  // and then 500s every request is harder to diagnose than one that won't boot.
  try {
    const cx = await pool.getConnection();
    await cx.ping();
    cx.release();
  } catch (err) {
    app.log.error(
      { err },
      `Cannot reach MySQL at ${env.db.host}:${env.db.port}/${env.db.database}. ` +
      'Is it running, and is server/.env correct?',
    );
    process.exit(1);
  }

  const timers: NodeJS.Timeout[] = [];

  const sweep = async () => {
    try {
      const [sessions, imports, lapsed] = await Promise.all([
        sweepExpiredSessions(),
        sweepExpiredImports(),
        sweepLapsed(),
      ]);
      if (sessions || imports || lapsed.properties || lapsed.leads) {
        app.log.info(
          { sessions, imports, ...lapsed },
          'housekeeping sweep',
        );
      }
    } catch (err) {
      // Never let a sweep failure take the process down.
      app.log.error({ err }, 'housekeeping sweep failed');
    }
  };

  await sweep();
  timers.push(setInterval(sweep, SWEEP_INTERVAL_MS));

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    for (const t of timers) clearInterval(t);
    try {
      await app.close();
      await closePool();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: env.port, host: '0.0.0.0' });
  app.log.info(`Prospector API on :${env.port} (${env.nodeEnv})`);
}

main().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
