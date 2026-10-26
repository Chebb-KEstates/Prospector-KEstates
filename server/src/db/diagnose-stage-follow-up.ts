/**
 * READ-ONLY preview of the stage follow-up rule: which brokers the next
 * housekeeping sweep would WARN (24 hours' notice), and which units it would
 * RECLAIM (overdue and warned at least 24 hours ago). Changes nothing.
 *
 *   npm run diagnose:stages
 *
 * Run it after `npm run migrate` and BEFORE starting the new server, so you know
 * what the first sweep will do. Owner-group siblings of a reclaimed unit go with
 * it (reclaim keeps an owner's same-area units together); they are not listed.
 */
import { pool, closePool, Row } from './pool';
import { loadSettings } from '../repositories/settingsRepo';
import {
  scanStageFollowUp, needsWarning, isDue, reclaimAt, TIMED_STAGES, StageFollowUpUnit,
} from '../services/stageFollowUpService';
import { PropertyStageLabel } from '../../../src/types/models';

async function main() {
  const settings = await loadSettings();
  console.log('Stage follow-up limits (0 = off):');
  for (const s of TIMED_STAGES) console.log(`  ${PropertyStageLabel[s].padEnd(18)} ${settings.stageIdleDays(s)} days`);

  const scan = await scanStageFollowUp(settings);
  const warn = scan.filter(needsWarning);
  const due = scan.filter(u => isDue(u));
  if (scan.length === 0) {
    console.log('\nNothing to warn about or reclaim right now.');
    return;
  }

  const [labels] = await pool.query<Row[]>(
    `SELECT p.id, p.community, p.cluster, p.building, p.unit_number, p.plot_number, u.name AS broker
       FROM properties p LEFT JOIN users u ON u.id = p.assigned_to
      WHERE p.id IN (${scan.map(() => '?').join(', ')})`,
    scan.map(d => d.id),
  );
  const byId = new Map(labels.map(r => [r.id as string, r]));
  const line = (d: StageFollowUpUnit, extra: string) => {
    const r = byId.get(d.id);
    const unit = [r?.community, r?.cluster, r?.building, r?.unit_number ?? r?.plot_number].filter(Boolean).join(' · ');
    const idle = Math.floor((Date.now() - new Date(d.lastActivity).getTime()) / 86_400_000);
    console.log(`  ${unit}\n    ${PropertyStageLabel[d.stage]} · ${r?.broker ?? d.assignedTo} · `
      + `last activity ${d.lastActivity.slice(0, 10)} (${idle} days, limit ${d.idleDays}) · ${extra}`);
  };

  console.log(`\n${warn.length} broker reminder(s) would be sent now (24 hours' notice):\n`);
  for (const d of warn) line(d, `goes back no earlier than ${reclaimAt(d).slice(0, 16).replace('T', ' ')} UTC`);
  console.log(`\n${due.length} unit(s) would go back to the pool now (warned 24h+ ago):\n`);
  for (const d of due) line(d, `warned ${d.warnedAt!.slice(0, 16).replace('T', ' ')} UTC`);
  const waiting = scan.length - warn.length - due.length;
  if (waiting > 0) console.log(`\n${waiting} more already warned, still inside their 24 hours.`);
}

main()
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(() => closePool());
