/**
 * READ-ONLY preview of the stage follow-up rule: which assigned units would go
 * back to the pool on the next housekeeping sweep, and why. Changes nothing.
 *
 *   npm run diagnose:stages
 *
 * Run it after `npm run migrate` and BEFORE starting the new server, so you know
 * what the first sweep will do. Owner-group siblings of each unit go with it
 * (reclaim keeps an owner's same-area units together); they are not listed.
 */
import { pool, closePool, Row } from './pool';
import { loadSettings } from '../repositories/settingsRepo';
import { findStaleStageUnits, TIMED_STAGES } from '../services/stageFollowUpService';
import { PropertyStageLabel } from '../../../src/types/models';

async function main() {
  const settings = await loadSettings();
  console.log('Stage follow-up limits (0 = off):');
  for (const s of TIMED_STAGES) console.log(`  ${PropertyStageLabel[s].padEnd(18)} ${settings.stageIdleDays(s)} days`);

  const due = await findStaleStageUnits(settings);
  if (due.length === 0) {
    console.log('\nNothing would be reclaimed right now.');
    return;
  }
  const [labels] = await pool.query<Row[]>(
    `SELECT p.id, p.community, p.cluster, p.building, p.unit_number, p.plot_number, u.name AS broker
       FROM properties p LEFT JOIN users u ON u.id = p.assigned_to
      WHERE p.id IN (${due.map(() => '?').join(', ')})`,
    due.map(d => d.id),
  );
  const byId = new Map(labels.map(r => [r.id as string, r]));
  console.log(`\n${due.length} unit(s) would go back to the pool on the next sweep:\n`);
  for (const d of due) {
    const r = byId.get(d.id);
    const unit = [r?.community, r?.cluster, r?.building, r?.unit_number ?? r?.plot_number].filter(Boolean).join(' · ');
    const idle = Math.floor((Date.now() - new Date(d.lastActivity).getTime()) / 86_400_000);
    console.log(`  ${unit}\n    ${PropertyStageLabel[d.stage]} · ${r?.broker ?? d.assignedTo} · last activity ${d.lastActivity.slice(0, 10)} (${idle} days, limit ${d.idleDays})`);
  }
}

main()
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(() => closePool());
