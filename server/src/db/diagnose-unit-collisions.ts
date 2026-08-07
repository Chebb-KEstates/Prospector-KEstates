import mysql from 'mysql2/promise';
import { env } from '../config/env';

/**
 * READ-ONLY diagnostic for the migration 010 failure.
 *
 * Migration 010 collapses the unit key
 *     u|community|cluster|building|unit  ->  u|building|unit
 *     p|community|plot                   ->  p|plot
 * so a unit is identified by its number alone. On real data, rows that were
 * historically imported with DIFFERENT community labels but the SAME building +
 * unit collapse to the same key and collide on UNIQUE (org_id, unit_key_hash) —
 * which is exactly the 010 failure we hit on the server.
 *
 * This script does NOT change anything. It reports how many such collisions
 * exist and, crucially, whether any of the colliding rows carry real work
 * (a broker's portfolio/assignment, logged calls, saved notes). That decides
 * whether the fix can simply drop inert duplicates or has to merge histories.
 *
 * Run from server/:  npm run diagnose:units
 */

// The projected new key each row WOULD get from migration 010. Kept identical
// to 010_unit_key_drop_community.sql so the collision picture matches reality.
const NEWKEY = `
  CASE
    WHEN p.unit_key LIKE 'u|%|%|%|%'
      THEN CONCAT('u|',
             SUBSTRING_INDEX(SUBSTRING_INDEX(p.unit_key, '|', 4), '|', -1), '|',
             SUBSTRING_INDEX(p.unit_key, '|', -1))
    WHEN p.unit_key LIKE 'p|%|%'
      THEN CONCAT('p|', SUBSTRING_INDEX(p.unit_key, '|', -1))
    ELSE p.unit_key
  END`;

// A row "has work" if losing it would lose something a broker cares about.
const HAS_WORK = `(
  p.state <> 'pool'
  OR p.assigned_to IS NOT NULL
  OR p.call_attempts > 0
  OR p.notes IS NOT NULL
  OR EXISTS (SELECT 1 FROM call_properties cp WHERE cp.property_id = p.id)
)`;

async function main() {
  const cx = await mysql.createConnection({
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    database: env.db.database,
    multipleStatements: false,
    timezone: 'Z',
  });

  const q = async (sql: string) => {
    const [rows] = await cx.query<mysql.RowDataPacket[]>(sql);
    return rows;
  };

  try {
    const line = '─'.repeat(72);
    console.log(`\n${line}\nUNIT-KEY COLLISION DIAGNOSTIC (read-only)\n${line}`);

    const [totals] = await q(`
      SELECT
        COUNT(*)                                               AS total,
        SUM(unit_key LIKE 'u|%|%|%|%')                         AS old_unit_format,
        SUM(unit_key LIKE 'p|%|%')                             AS old_plot_format
      FROM properties p`);
    console.log(
      `\nProperties total: ${totals.total}` +
      `\n  in old 5-part unit format (u|...):  ${totals.old_unit_format}` +
      `\n  in old 3-part plot format (p|...):  ${totals.old_plot_format}`,
    );

    // Groups of rows that would collapse onto the same (org_id, new key).
    const groups = await q(`
      SELECT org_id, newkey, COUNT(*) AS n, SUM(has_work) AS work_rows
      FROM (
        SELECT p.org_id, (${NEWKEY}) COLLATE utf8mb4_bin AS newkey, ${HAS_WORK} AS has_work
        FROM properties p
      ) t
      GROUP BY org_id, newkey
      HAVING n > 1
      ORDER BY work_rows DESC, n DESC`);

    const totalDupRows = groups.reduce((s, g) => s + Number(g.n), 0);
    const rowsToRemove = groups.reduce((s, g) => s + (Number(g.n) - 1), 0);
    const hardGroups = groups.filter(g => Number(g.work_rows) > 1);

    console.log(`\n${line}\nSUMMARY\n${line}`);
    if (groups.length === 0) {
      console.log('\n✅ No collisions. Migration 010 will apply cleanly — just re-run `npm run migrate`.');
      return;
    }
    console.log(
      `\nCollision groups (same unit, different community label): ${groups.length}` +
      `\n  duplicate rows involved:            ${totalDupRows}` +
      `\n  rows that must be removed/merged:   ${rowsToRemove}` +
      `\n  groups where >1 row carries work:   ${hardGroups.length}  <-- these need a careful merge`,
    );
    console.log(
      hardGroups.length === 0
        ? '\n➡  Every group has at most ONE row with real work (calls/notes/portfolio).' +
          '\n   The fix is safe & simple: keep the working (or newest) row, drop the inert duplicates.'
        : '\n⚠  Some groups have MORE THAN ONE row carrying real work — a broker\'s calls,' +
          '\n   notes or portfolio sit on both copies. These are listed below and need a' +
          '\n   merge decision before anything is deleted. Do NOT force the migration.',
    );

    // Per-row detail for the worst (most-conflicted) groups first. Capped so the
    // paste stays manageable; the summary above already counts everything. No
    // window functions here on purpose — this must run on MySQL 5.7 / MariaDB too,
    // so we drive it from the group list we already have and a tuple filter.
    const shown = groups.slice(0, 40);
    const grpMeta = new Map(shown.map(g => [`${g.org_id}::${g.newkey}`, g]));
    const params: string[] = [];
    const tuples = shown.map(g => { params.push(g.org_id as string, g.newkey as string); return '(?, ?)'; }).join(', ');
    const [detail] = await cx.query<mysql.RowDataPacket[]>(
      `SELECT
         p.org_id,
         (${NEWKEY}) COLLATE utf8mb4_bin                                        AS newkey,
         p.id, p.unit_key, p.state, p.assigned_to,
         p.call_attempts                                                        AS attempts,
         (p.notes IS NOT NULL)                                                  AS has_notes,
         (SELECT COUNT(*) FROM call_properties cp WHERE cp.property_id = p.id)   AS calls,
         (SELECT COUNT(*) FROM request_units  ru WHERE ru.property_id = p.id)    AS reqs,
         (SELECT COUNT(*) FROM audit_properties ap WHERE ap.property_id = p.id)  AS audits,
         ${HAS_WORK}                                                            AS has_work
       FROM properties p
       WHERE (p.org_id, (${NEWKEY}) COLLATE utf8mb4_bin) IN (${tuples})
       ORDER BY newkey, has_work DESC`,
      params,
    );

    console.log(`\n${line}\nDETAIL — first ${shown.length} group(s), most-conflicted first (★ = row carries work)\n${line}`);
    // Print in the group order the summary chose (conflicted groups first).
    const byKey = new Map<string, mysql.RowDataPacket[]>();
    for (const r of detail) {
      const k = `${r.org_id}::${r.newkey}`;
      (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(r);
    }
    for (const [k, meta] of grpMeta) {
      const rows = byKey.get(k) ?? [];
      console.log(`\n[${meta.newkey}]  (${meta.n} copies, ${meta.work_rows} with work)`);
      for (const r of rows) {
        const flags = [
          r.state !== 'pool' ? r.state : null,
          r.assigned_to ? `assigned→${r.assigned_to}` : null,
          Number(r.attempts) ? `${r.attempts} attempts` : null,
          Number(r.calls) ? `${r.calls} calls` : null,
          Number(r.reqs) ? `${r.reqs} reqs` : null,
          Number(r.audits) ? `${r.audits} audit` : null,
          Number(r.has_notes) ? 'notes' : null,
        ].filter(Boolean).join(', ') || 'inert (pool, no work)';
        console.log(`   ${Number(r.has_work) ? '★' : ' '} ${r.id}  ${r.unit_key}\n        ${flags}`);
      }
    }
    if (groups.length > shown.length) console.log(`\n… (${groups.length - shown.length} more group(s) not printed; summary counts include them)`);

    console.log(`\n${line}\nPaste this whole output back and I'll ship the exact, safe fix.\n${line}\n`);
  } finally {
    await cx.end();
  }
}

main().catch(err => {
  console.error('\nDiagnostic failed:\n', err instanceof Error ? err.message : err);
  process.exit(1);
});
