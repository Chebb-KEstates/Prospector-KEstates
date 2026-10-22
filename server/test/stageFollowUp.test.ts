import test from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { pool, closePool, toDb } from '../src/db/pool';
import { saveProperties, findPropertyById } from '../src/repositories/propertyRepo';
import { insertCall } from '../src/repositories/callRepo';
import { writeAudit } from '../src/repositories/auditRepo';
import { loadSettings, saveSettings } from '../src/repositories/settingsRepo';
import { insertUser } from '../src/repositories/userRepo';
import { createSession, SESSION_COOKIE, CSRF_HEADER } from '../src/auth/sessions';
import { sweepStaleStages, findStaleStageUnits } from '../src/services/stageFollowUpService';
import {
  CallLog, CallOutcome, OwnerInfo, Property, PropertyStage, PropertyState, VaultSettings, kOrgId,
} from '../../src/types/models';
import { AppUser, UserRole } from '../../src/types/user';
import { ImportPipeline } from '../../src/logic/importPipeline';
import { newCallId, newPropertyId, newUserId } from '../src/domain/ids';

/**
 * Stage follow-up: an ASSIGNED unit in Prospecting / Market appraisal / Listed
 * offline goes back to the pool when its broker hasn't logged a call on it for
 * 30 / 14 / 7 days (adjustable; 0 = off), counted from the latest of their last
 * call, the stage entry and the assignment.
 */

let app: FastifyInstance;
let manager: string, broker: string, other: string;
let auth: { cookie: string; csrf: string };
let original: VaultSettings;

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
/** Every other timer off (as on production after migration 018) — only this rule acts. */
const rules = (p = 30, a = 14, o = 7) => new VaultSettings(0, 0, 3, 14, 0, '', 0, 0, 0, 0, 0, p, a, o);

test.before(async () => {
  original = await loadSettings();
  manager = newUserId(); broker = newUserId(); other = newUserId();
  const mk = (id: string, name: string, role: UserRole) => insertUser({
    user: new AppUser(id, name, `${id}@test.local`, role, true, 'QA', undefined, new Date().toISOString()),
    passwordHash: 'scrypt$131072$8$1$AAAA$AAAA', mustChangePassword: false,
  });
  await mk(manager, 'Manager', UserRole.manager);
  await mk(broker, 'Bea Broker', UserRole.broker);
  await mk(other, 'Otto Other', UserRole.broker);
  const s = await createSession(manager, {});
  auth = { cookie: `${SESSION_COOKIE}=${s.token}`, csrf: s.csrfToken };
  app = await buildApp();
  await app.ready();
});

test.after(async () => {
  await saveSettings(original);
  await app.close();
  await closePool();
});

async function wipe() {
  await pool.query('DELETE FROM requests WHERE org_id = ?', [kOrgId]);
  await pool.query('DELETE FROM calls WHERE org_id = ?', [kOrgId]);
  await pool.query('DELETE FROM properties WHERE org_id = ?', [kOrgId]);
}

let seq = 0;
/**
 * A unit held by `holder` since `assignedDaysAgo`, put into `stage`
 * `stageDaysAgo` days ago (a real 'stage' journal row, back-dated).
 */
async function heldUnit(opts: {
  stage: PropertyStage; assignedDaysAgo: number; stageDaysAgo?: number;
  holder?: string | null; state?: PropertyState; owner?: string; phone?: string;
}): Promise<Property> {
  seq += 1;
  const n = String(seq);
  const community = 'Follow Hills';
  const unitKey = ImportPipeline.unitKeyFor({ community, building: 'F', unitNumber: n })!;
  const p = new Property(
    newPropertyId(), kOrgId, '', opts.state ?? PropertyState.assigned, unitKey, community,
    undefined, 'F', n, undefined, 'Villa', 3, 2000, undefined, undefined, undefined, 0,
    undefined, undefined, undefined,
    new OwnerInfo(opts.owner ?? `Owner ${n}`, opts.phone ?? `9715010${n.padStart(5, '0')}`),
    daysAgo(400), daysAgo(400),
  );
  const holder = opts.holder === undefined ? broker : opts.holder;
  if (holder) { p.assignedTo = holder; p.assignedAt = daysAgo(opts.assignedDaysAgo); }
  await saveProperties([p]);
  await pool.query('UPDATE properties SET stage = ? WHERE id = ?', [opts.stage, p.id]);
  if (opts.stageDaysAgo != null) {
    const a = await writeAudit({ actorId: holder ?? manager, action: 'stage', detail: `Stage: None → ${opts.stage}`, propertyIds: [p.id] });
    await pool.query('UPDATE audit SET at = ? WHERE id = ?', [toDb(daysAgo(opts.stageDaysAgo)), a.id]);
  }
  return p;
}

async function callOn(p: Property, by: string, dAgo: number, outcome = CallOutcome.noAnswer, note?: string) {
  await insertCall(new CallLog(newCallId(), kOrgId, [p.id], [], by, daysAgo(dAgo), outcome, note));
}

const heldBy = async (p: Property) => {
  const x = (await findPropertyById(p.id))!;
  return { state: x.state, assignedTo: x.assignedTo, stage: x.stage };
};

test('Prospecting with no call for 30+ days goes back to the pool — stage kept, journal says why', async () => {
  await wipe(); await saveSettings(rules());
  const p = await heldUnit({ stage: PropertyStage.prospecting, assignedDaysAgo: 45, stageDaysAgo: 40 });
  const r = await sweepStaleStages();
  assert.equal(r.reclaimed, 1);
  assert.deepEqual(await heldBy(p), { state: PropertyState.pool, assignedTo: undefined, stage: PropertyStage.prospecting });
  const [rows] = await pool.query<any[]>(
    `SELECT a.actor_id, a.detail FROM audit a JOIN audit_properties ap ON ap.audit_id = a.id
      WHERE ap.property_id = ? AND a.action = 'reclaim'`, [p.id]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].actor_id, null, 'the system, not a person');
  assert.equal(rows[0].detail, 'Auto Reclaimed — no call logged by Bea Broker for 30 days in Prospecting');
});

test('each stage has its own limit: 30 / 14 / 7 days', async () => {
  await wipe(); await saveSettings(rules());
  const prosOk = await heldUnit({ stage: PropertyStage.prospecting, assignedDaysAgo: 29, stageDaysAgo: 29 });
  const apprGone = await heldUnit({ stage: PropertyStage.marketAppraisal, assignedDaysAgo: 15, stageDaysAgo: 15 });
  const apprOk = await heldUnit({ stage: PropertyStage.marketAppraisal, assignedDaysAgo: 13, stageDaysAgo: 13 });
  const offGone = await heldUnit({ stage: PropertyStage.listedOffline, assignedDaysAgo: 8, stageDaysAgo: 8 });
  const offOk = await heldUnit({ stage: PropertyStage.listedOffline, assignedDaysAgo: 6, stageDaysAgo: 6 });
  await sweepStaleStages();
  assert.equal((await heldBy(prosOk)).assignedTo, broker);
  assert.equal((await heldBy(apprGone)).assignedTo, undefined);
  assert.equal((await heldBy(apprOk)).assignedTo, broker);
  assert.equal((await heldBy(offGone)).assignedTo, undefined);
  assert.equal((await heldBy(offOk)).assignedTo, broker);
});

test('any call result by the responsible broker resets the clock — with or without text', async () => {
  await wipe(); await saveSettings(rules());
  const bare = await heldUnit({ stage: PropertyStage.prospecting, assignedDaysAgo: 60, stageDaysAgo: 60 });
  await callOn(bare, broker, 10, CallOutcome.noAnswer); // no feedback text at all
  const withText = await heldUnit({ stage: PropertyStage.listedOffline, assignedDaysAgo: 60, stageDaysAgo: 60 });
  await callOn(withText, broker, 3, CallOutcome.callbackLater, 'owner travelling');
  const stale = await heldUnit({ stage: PropertyStage.listedOffline, assignedDaysAgo: 60, stageDaysAgo: 60 });
  await callOn(stale, broker, 9, CallOutcome.noAnswer); // older than 7 days
  await sweepStaleStages();
  assert.equal((await heldBy(bare)).assignedTo, broker);
  assert.equal((await heldBy(withText)).assignedTo, broker);
  assert.equal((await heldBy(stale)).assignedTo, undefined);
});

test('a call by SOMEONE ELSE does not count — it must be the responsible broker', async () => {
  await wipe(); await saveSettings(rules());
  const p = await heldUnit({ stage: PropertyStage.marketAppraisal, assignedDaysAgo: 40, stageDaysAgo: 40 });
  await callOn(p, other, 1, CallOutcome.callbackLater, 'Otto rang');
  await callOn(p, manager, 1, CallOutcome.callbackLater, 'manager rang');
  await sweepStaleStages();
  assert.equal((await heldBy(p)).assignedTo, undefined);
});

test('the clock starts from the latest of: last call, entering the stage, being assigned', async () => {
  await wipe(); await saveSettings(rules());
  // Just moved into the stage (assigned long ago, never called) → full window.
  const newStage = await heldUnit({ stage: PropertyStage.listedOffline, assignedDaysAgo: 90, stageDaysAgo: 2 });
  // Just taken over (stage set long ago, never called) → full window.
  const newOwner = await heldUnit({ stage: PropertyStage.prospecting, assignedDaysAgo: 3, stageDaysAgo: 90 });
  // Stage set before 4.0 tracked it (no journal row) — falls back to the assignment.
  const noRow = await heldUnit({ stage: PropertyStage.marketAppraisal, assignedDaysAgo: 20 });
  await sweepStaleStages();
  assert.equal((await heldBy(newStage)).assignedTo, broker);
  assert.equal((await heldBy(newOwner)).assignedTo, broker);
  assert.equal((await heldBy(noRow)).assignedTo, undefined, '20 days since assignment > 14');
});

test('None, Listed online, pooled and do-not-call units are never touched', async () => {
  await wipe(); await saveSettings(rules(1, 1, 1));
  const none = await heldUnit({ stage: PropertyStage.none, assignedDaysAgo: 300, stageDaysAgo: 300 });
  const online = await heldUnit({ stage: PropertyStage.listedOnline, assignedDaysAgo: 300, stageDaysAgo: 300 });
  const pooled = await heldUnit({ stage: PropertyStage.prospecting, assignedDaysAgo: 300, stageDaysAgo: 300, holder: null, state: PropertyState.pool });
  const dnc = await heldUnit({ stage: PropertyStage.prospecting, assignedDaysAgo: 300, stageDaysAgo: 300, state: PropertyState.dnc });
  const r = await sweepStaleStages();
  assert.equal(r.reclaimed, 0);
  assert.equal((await heldBy(none)).assignedTo, broker);
  assert.equal((await heldBy(online)).assignedTo, broker);
  assert.equal((await heldBy(pooled)).state, PropertyState.pool);
  assert.deepEqual(await heldBy(dnc), { state: PropertyState.dnc, assignedTo: broker, stage: PropertyStage.prospecting });
});

test('interested and cooling units the broker holds are covered too', async () => {
  await wipe(); await saveSettings(rules());
  const kept = await heldUnit({ stage: PropertyStage.listedOffline, assignedDaysAgo: 20, stageDaysAgo: 20, state: PropertyState.portfolio });
  const cooled = await heldUnit({ stage: PropertyStage.marketAppraisal, assignedDaysAgo: 20, stageDaysAgo: 20, state: PropertyState.cooling });
  await sweepStaleStages();
  assert.deepEqual(await heldBy(kept), { state: PropertyState.pool, assignedTo: undefined, stage: PropertyStage.listedOffline });
  assert.equal((await heldBy(cooled)).state, PropertyState.pool);
});

test('0 switches a stage\'s rule off; the others keep working', async () => {
  await wipe(); await saveSettings(rules(0, 14, 7));
  const pros = await heldUnit({ stage: PropertyStage.prospecting, assignedDaysAgo: 200, stageDaysAgo: 200 });
  const appr = await heldUnit({ stage: PropertyStage.marketAppraisal, assignedDaysAgo: 200, stageDaysAgo: 200 });
  await sweepStaleStages();
  assert.equal((await heldBy(pros)).assignedTo, broker);
  assert.equal((await heldBy(appr)).assignedTo, undefined);

  await wipe(); await saveSettings(rules(0, 0, 0));
  const off = await heldUnit({ stage: PropertyStage.listedOffline, assignedDaysAgo: 200, stageDaysAgo: 200 });
  assert.equal((await sweepStaleStages()).reclaimed, 0);
  assert.equal((await heldBy(off)).assignedTo, broker);
});

test('owner groups: a call on any of the owner\'s same-area units keeps them all; a lapse takes them all', async () => {
  await wipe(); await saveSettings(rules());
  // Owner A: a1 neglected in Prospecting, a2 called by the broker 2 days ago.
  const a1 = await heldUnit({ stage: PropertyStage.prospecting, assignedDaysAgo: 60, stageDaysAgo: 60, owner: 'Ann Group', phone: '971509990001' });
  const a2 = await heldUnit({ stage: PropertyStage.none, assignedDaysAgo: 60, owner: 'Ann Group', phone: '971509990001' });
  await callOn(a2, broker, 2);
  // Owner B: b1 lapsed in Listed offline; its sibling b2 (stage None) goes with it.
  const b1 = await heldUnit({ stage: PropertyStage.listedOffline, assignedDaysAgo: 30, stageDaysAgo: 30, owner: 'Ben Group', phone: '971509990002' });
  const b2 = await heldUnit({ stage: PropertyStage.none, assignedDaysAgo: 30, owner: 'Ben Group', phone: '971509990002' });
  const r = await sweepStaleStages();
  assert.equal((await heldBy(a1)).assignedTo, broker, 'working a2 keeps a1');
  assert.equal((await heldBy(a2)).assignedTo, broker);
  assert.equal((await heldBy(b1)).assignedTo, undefined);
  assert.equal((await heldBy(b2)).assignedTo, undefined, 'the owner is never split');
  assert.equal(r.reclaimed, 2);
});

test('running twice reclaims once; the preview never changes anything', async () => {
  await wipe(); await saveSettings(rules());
  const p = await heldUnit({ stage: PropertyStage.prospecting, assignedDaysAgo: 31, stageDaysAgo: 31 });
  const preview = await findStaleStageUnits(await loadSettings());
  assert.deepEqual(preview.map(x => x.id), [p.id]);
  assert.equal((await heldBy(p)).assignedTo, broker, 'preview is read-only');
  assert.equal((await sweepStaleStages()).reclaimed, 1);
  assert.equal((await sweepStaleStages()).reclaimed, 0);
});

test('a call logged after the scan still wins (the unit is re-checked under its lock)', async () => {
  await wipe(); await saveSettings(rules());
  const p = await heldUnit({ stage: PropertyStage.prospecting, assignedDaysAgo: 31, stageDaysAgo: 31 });
  assert.equal((await findStaleStageUnits(await loadSettings())).length, 1);
  await callOn(p, broker, 0); // lands between the scan and the reclaim
  const [still] = await findStaleStageUnits(await loadSettings(), { onlyId: p.id });
  assert.equal(still, undefined);
  assert.equal((await sweepStaleStages()).reclaimed, 0);
  assert.equal((await heldBy(p)).assignedTo, broker);
});

test('the Settings API stores the three limits, 0 included', async () => {
  await saveSettings(rules());
  const res = await app.inject({
    method: 'PATCH', url: '/api/settings',
    headers: { cookie: auth.cookie, [CSRF_HEADER]: auth.csrf },
    payload: { stageIdleProspectingDays: 45, stageIdleAppraisalDays: 0, stageIdleOfflineDays: 3 },
  });
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(
    [JSON.parse(res.body).stageIdleProspectingDays, JSON.parse(res.body).stageIdleAppraisalDays, JSON.parse(res.body).stageIdleOfflineDays],
    [45, 0, 3]);
  const s = await loadSettings();
  assert.deepEqual([s.stageIdleProspectingDays, s.stageIdleAppraisalDays, s.stageIdleOfflineDays], [45, 0, 3]);
  const bad = await app.inject({
    method: 'PATCH', url: '/api/settings',
    headers: { cookie: auth.cookie, [CSRF_HEADER]: auth.csrf },
    payload: { stageIdleOfflineDays: -1 },
  });
  assert.equal(bad.statusCode, 400);
});
