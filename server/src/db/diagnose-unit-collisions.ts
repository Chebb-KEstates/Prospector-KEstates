import mysql from 'mysql2/promise';
import { env } from '../config/env';

/**
 * READ-ONLY diagnostic for the migration 010 failure.
 *
 * Migration 010 collapses the unit key
 *     u|community|cluster|building|unit  ->  u|building|unit
 *     p|community|plot                   ->  p|plot
 * so a unit is identified by its NUMBER + BUILDING alone. That assumes the tower
 * lives in the `building` field. In real KEstates data the building field is
 * often EMPTY and the tower/development name sits in community/cluster — so
 * "unit 101" in five different towers all collapse to `u||101` and collide on
 * UNIQUE (org_id, unit_key_hash). That is the 010 failure on the server.
 *
 * The critical question this answers: of the colliding rows, how many are GENUINE
 * duplicates (same physical building, only the community label differs — safe to
 * merge) versus DIFFERENT buildings that merely share a unit number (must NOT be
 * merged — merging would delete real, distinct inventory)?
 *
 * Read-only. Changes nothing. Run from server/:  npm run diagnose:units
 */

// The projected new key each row WOULD get from migration 010. Identical to
// 010_unit_key_drop_community.sql so the collision picture matches reality.
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

// The physical building of a unit = cluster + building, case/space-insensitive.
// Community is treated as the correctable LABEL (the thing 010 wanted to drop),
// so two rows are genuine duplicates when their cluster+building match and only
// the community differs. Different cluster/building = genuinely different towers.
const TOWER = `CONCAT_WS('§',
  LOWER(TRIM(COALESCE(p.cluster, ''))),
  LOWER(TRIM(COALESCE(p.building, ''))))`;

// A row "has work" if losing it would lose something a broker cares about.
const HAS_WORK = `(
  p.state <> 'pool'
  OR p.assigned_to IS NOT NULL
  OR p.call_attempts > 0
  OR p.notes IS NOT NULL
  OR EXISTS (SELECT 1 FROM call_properties cp WHERE cp.property_id = p.id)
)`;

const towerSig = (r: mysql.RowDataPacket) =>
  `${(r.cluster ?? '').trim().toLowerCase()}§${(r.building ?? '').trim().toLowerCase()}`;

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
        SUM(unit_key LIKE 'p|%|%')                             AS old_plot_format,
        SUM(building IS NULL OR building = '')                 AS blank_building
      FROM properties p`);
    console.log(
      `\nProperties total: ${totals.total}` +
      `\n  in old 5-part unit format (u|...):  ${totals.old_unit_format}` +
      `\n  in old 3-part plot format (p|...):  ${totals.old_plot_format}` +
      `\n  with a BLANK building field:        ${totals.blank_building}   (tower name is in community/cluster instead)`,
    );

    // Collision groups + how many rows carry work + how many DISTINCT physical
    // buildings each group actually spans.
    const groups = await q(`
      SELECT org_id, newkey, COUNT(*) AS n, SUM(has_work) AS work_rows,
             COUNT(DISTINCT tower) AS towers
      FROM (
        SELECT p.org_id,
               (${NEWKEY}) COLLATE utf8mb4_bin AS newkey,
               ${TOWER} AS tower,
               ${HAS_WORK} AS has_work
        FROM properties p
      ) t
      GROUP BY org_id, newkey
      HAVING n > 1
      ORDER BY (n - towers) DESC, work_rows DESC, n DESC`);

    if (groups.length === 0) {
      console.log(`\n${line}\nSUMMARY\n${line}`);
      console.log('\n✅ No collisions. Migration 010 will apply cleanly — just re-run `npm run migrate`.');
      return;
    }

    const totalDupRows = groups.reduce((s, g) => s + Number(g.n), 0);
    const trueDupeRows = groups.reduce((s, g) => s + (Number(g.n) - Number(g.towers)), 0);
    const distinctGroups = groups.filter(g => Number(g.towers) === Number(g.n)).length;   // every row a different building
    const dupeGroups = groups.filter(g => Number(g.towers) < Number(g.n)).length;         // at least one genuine duplicate
    const distinctUnitsLost = totalDupRows - groups.length - trueDupeRows;                 // distinct units 010 would delete

    console.log(`\n${line}\nSUMMARY\n${line}`);
    console.log(
      `\nCollision groups (rows that 010 would merge into one): ${groups.length}` +
      `\n  total rows in those groups:                 ${totalDupRows}` +
      `\n  groups that are DIFFERENT buildings:        ${distinctGroups}   (NOT duplicates — must not merge)` +
      `\n  groups containing genuine duplicates:       ${dupeGroups}` +
      `\n  genuine duplicate rows (safe to merge):     ${trueDupeRows}` +
      `\n  DISTINCT units 010 would wrongly delete:    ${distinctUnitsLost}   <-- data loss if forced`,
    );

    if (trueDupeRows === 0) {
      console.log(
        '\n⛔ NONE of these are duplicates. Every collision is DIFFERENT buildings that share a' +
        '\n   unit number, because the building field is blank and the tower name lives in' +
        '\n   community/cluster. Migration 010 (identity = number only) is wrong for this data —' +
        `\n   forcing it would delete ${distinctUnitsLost} real, distinct units. The identity must keep the tower.`,
      );
    } else {
      console.log(
        `\n⚠  Mixed: ${trueDupeRows} genuine duplicate row(s) could be merged, but ${distinctUnitsLost} rows are` +
        '\n   DISTINCT buildings that 010 would wrongly delete. Do NOT force 010 — the identity' +
        '\n   needs to keep the tower, and only the genuine duplicates should be merged.',
      );
    }

    // Per-group detail, groups with the most genuine duplicates first.
    const shown = groups.slice(0, 40);
    const grpMeta = new Map(shown.map(g => [`${g.org_id}::${g.newkey}`, g]));
    const p: string[] = [];
    const tuples = shown.map(g => { p.push(g.org_id as string, g.newkey as string); return '(?, ?)'; }).join(', ');
    const [detail] = await cx.query<mysql.RowDataPacket[]>(
      `SELECT
         p.org_id,
         (${NEWKEY}) COLLATE utf8mb4_bin                                        AS newkey,
         p.id, p.unit_key, p.community, p.cluster, p.building, p.state, p.assigned_to,
         p.call_attempts                                                        AS attempts,
         (p.notes IS NOT NULL)                                                  AS has_notes,
         (SELECT COUNT(*) FROM call_properties cp WHERE cp.property_id = p.id)   AS calls,
         (SELECT COUNT(*) FROM request_units  ru WHERE ru.property_id = p.id)    AS reqs,
         (SELECT COUNT(*) FROM audit_properties ap WHERE ap.property_id = p.id)  AS audits,
         ${HAS_WORK}                                                            AS has_work
       FROM properties p
       WHERE (p.org_id, (${NEWKEY}) COLLATE utf8mb4_bin) IN (${tuples})
       ORDER BY newkey, has_work DESC`,
      p,
    );

    console.log(`\n${line}\nDETAIL — first ${shown.length} group(s)  (★ = row carries work)\n${line}`);
    const byKey = new Map<string, mysql.RowDataPacket[]>();
    for (const r of detail) {
      const k = `${r.org_id}::${r.newkey}`;
      (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(r);
    }
    for (const [k, meta] of grpMeta) {
      const rows = byKey.get(k) ?? [];
      const towers = new Set(rows.map(towerSig));
      const verdict = towers.size === rows.length
        ? `⛔ ${rows.length} DIFFERENT buildings — NOT duplicates`
        : `✓ contains ${rows.length - towers.size} genuine duplicate(s) across ${towers.size} building(s)`;
      console.log(`\n[${meta.newkey}]  ${verdict}`);
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
