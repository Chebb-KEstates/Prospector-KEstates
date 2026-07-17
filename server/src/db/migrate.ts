import * as fs from 'fs';
import * as path from 'path';
import mysql from 'mysql2/promise';
import { env } from '../config/env';

/**
 * Forward-only migration runner. Each .sql file in migrations/ runs once, in
 * filename order, and is recorded in schema_migrations. Statements are split on
 * semicolons at end-of-line, which is why migrations must not contain stored
 * procedures or triggers with inline semicolons.
 */

const MIGRATIONS_DIR = path.resolve(__dirname, 'migrations');

function splitStatements(sql: string): string[] {
  return sql
    .split('\n')
    .filter(line => !line.trim().startsWith('--'))
    .join('\n')
    .split(/;\s*(?:\n|$)/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

export async function runMigrations(log: (m: string) => void = console.log): Promise<void> {
  // Connect without a database first so we can create it if it's missing.
  const bootstrap = await mysql.createConnection({
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    multipleStatements: false,
  });
  await bootstrap.query(
    `CREATE DATABASE IF NOT EXISTS \`${env.db.database}\`
     CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  await bootstrap.end();

  const cx = await mysql.createConnection({
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    database: env.db.database,
    multipleStatements: false,
    timezone: 'Z',
  });

  try {
    await cx.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    VARCHAR(64) NOT NULL PRIMARY KEY,
        applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    const [rows] = await cx.query<mysql.RowDataPacket[]>('SELECT version FROM schema_migrations');
    const applied = new Set(rows.map(r => r.version as string));

    const files = fs.existsSync(MIGRATIONS_DIR)
      ? fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort()
      : [];

    if (files.length === 0) {
      log('No migration files found.');
      return;
    }

    let ran = 0;
    for (const file of files) {
      const version = file.replace(/\.sql$/, '');
      if (applied.has(version)) continue;

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      const statements = splitStatements(sql);

      // DDL in MySQL is not transactional, so a failed migration leaves partial
      // state. Each file is written to be idempotent (IF NOT EXISTS) so a rerun
      // after a fix is safe.
      for (const stmt of statements) {
        try {
          await cx.query(stmt);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          throw new Error(`Migration ${file} failed on statement:\n${stmt.slice(0, 300)}\n\n${msg}`);
        }
      }

      await cx.query('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [
        version,
        new Date(),
      ]);
      log(`  applied ${version} (${statements.length} statements)`);
      ran++;
    }

    log(ran === 0 ? 'Schema already up to date.' : `Applied ${ran} migration(s).`);
  } finally {
    await cx.end();
  }
}

if (require.main === module) {
  runMigrations()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('\nMigration failed:\n', err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
