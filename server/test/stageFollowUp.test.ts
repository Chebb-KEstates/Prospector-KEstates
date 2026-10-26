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
import { insertNotification, NotificationKind } from '../src/repositories/notificationRepo';
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

/** Age every reminder by 25 hours — as if a day had passed since it was sent. */
async function ageWarnings() {
  await pool.query('UPDATE notifications SET created_at = DATE_SUB(created_at, INTERVAL 25 HOUR)');
}

/** A reminder for `p`'s current broker, sent `hoursAgo`. */
async function insertWarning(p: Property, hoursAgo: number) {
  await insertNotification({
    userId: broker, kind: NotificationKind.stageReclaimWarning, propertyId: p.id,
    title: 't', body: 'b', dedupeKey: `test:${p.id}:${hoursAgo}`,
    at: new Date(Date.now() - hoursAgo * 3_600_000).toISOString(),
  });
}

/** The full cycle: sweep (warns), a day passes, sweep again (reclaims). Sums both. */
async function sweepFull() {
  const a = await sweepStaleStages();
  await ageWarnings();
  const b = await sweepStaleStages();
  return { warned: a.warned + b.warned, reclaimed: a.reclaimed + b.reclaimed };
}

const warningsFor = async (p: Property) => {
  const [rows] = await pool.query<any[]>(
    `SELECT user_id, title, body, read_at FROM notifications WHERE property_id = ? AND kind = 'stageReclaimWarning' ORDER BY created_at`,
    [p.id]);
  return rows as { user_id: string; title: string; body: string; read_at: unknown }[];
};

const heldBy = async (p: Property) => {
  const x = (await findPropertyById(p.id))!;
  return { state: x.state, assignedTo: x.assignedTo, stage: x.stage };
};

test('Prospecting with no call for 30+ days goes back to the pool — stage kept, journal says why', async () => {
  await wipe(); await saveSettings(rules());
  const p = await heldUnit({ stage: PropertyStage.prospecting, assignedDaysAgo: 45, stageDaysAgo: 40 });
  const r = await sweepFull();
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
  await sweepFull();
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
  await sweepFull();
  assert.equal((await heldBy(bare)).assignedTo, broker);
  assert.equal((await heldBy(withText)).assignedTo, broker);
  assert.equal((await heldBy(stale)).assignedTo, undefined);
});

test('a call by SOMEONE ELSE does not count — it must be the responsible broker', async () => {
  await wipe(); await saveSettings(rules());
  const p = await heldUnit({ stage: PropertyStage.marketAppraisal, assignedDaysAgo: 40, stageDaysAgo: 40 });
  await callOn(p, other, 1, CallOutcome.callbackLater, 'Otto rang');
  await callOn(p, manager, 1, CallOutcome.callbackLater, 'manager rang');
  await sweepFull();
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
  await sweepFull();
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
  const r = await sweepFull();
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
  await sweepFull();
  assert.deepEqual(await heldBy(kept), { state: PropertyState.pool, assignedTo: undefined, stage: PropertyStage.listedOffline });
  assert.equal((await heldBy(cooled)).state, PropertyState.pool);
});

test('0 switches a stage\'s rule off; the others keep working', async () => {
  await wipe(); await saveSettings(rules(0, 14, 7));
  const pros = await heldUnit({ stage: PropertyStage.prospecting, assignedDaysAgo: 200, stageDaysAgo: 200 });
  const appr = await heldUnit({ stage: PropertyStage.marketAppraisal, assignedDaysAgo: 200, stageDaysAgo: 200 });
  await sweepFull();
  assert.equal((await heldBy(pros)).assignedTo, broker);
  assert.equal((await heldBy(appr)).assignedTo, undefined);

  await wipe(); await saveSettings(rules(0, 0, 0));
  const off = await heldUnit({ stage: PropertyStage.listedOffline, assignedDaysAgo: 200, stageDaysAgo: 200 });
  assert.equal((await sweepFull()).reclaimed, 0);
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
  const r = await sweepFull();
  assert.equal((await heldBy(a1)).assignedTo, broker, 'working a2 keeps a1');
  assert.equal((await heldBy(a2)).assignedTo, broker);
  assert.equal((await heldBy(b1)).assignedTo, undefined);
  assert.equal((await heldBy(b2)).assignedTo, undefined, 'the owner is never split');
  assert.equal(r.reclaimed, 2);
});

test('running twice reclaims once; the preview never changes anything', async () => {
  await wipe(); await saveSettings(rules());
  const p = await heldUnit({ stage: PropertyStage.prospecting, assignedDaysAgo: 31, stageDaysAgo: 31 });
  await sweepStaleStages(); await ageWarnings(); // warned a day ago
  const preview = await findStaleStageUnits(await loadSettings());
  assert.deepEqual(preview.map(x => x.id), [p.id]);
  assert.equal((await heldBy(p)).assignedTo, broker, 'preview is read-only');
  assert.equal((await sweepStaleStages()).reclaimed, 1);
  assert.equal((await sweepStaleStages()).reclaimed, 0);
});

test('a call logged after the scan still wins (the unit is re-checked under its lock)', async () => {
  await wipe(); await saveSettings(rules());
  const p = await heldUnit({ stage: PropertyStage.prospecting, assignedDaysAgo: 31, stageDaysAgo: 31 });
  await sweepStaleStages(); await ageWarnings();
  assert.equal((await findStaleStageUnits(await loadSettings())).length, 1);
  await callOn(p, broker, 0); // lands between the scan and the reclaim
  const [still] = await findStaleStageUnits(await loadSettings(), { onlyId: p.id });
  assert.equal(still, undefined);
  assert.equal((await sweepStaleStages()).reclaimed, 0);
  assert.equal((await heldBy(p)).assignedTo, broker);
});

// ── The 24-hour reminder ──────────────────────────────────────────────────────

test('an overdue unit is never taken without notice: warned first, reclaimed 24h later', async () => {
  await wipe(); await saveSettings(rules());
  const p = await heldUnit({ stage: PropertyStage.listedOffline, assignedDaysAgo: 30, stageDaysAgo: 30 });
  const first = await sweepStaleStages();
  assert.deepEqual(first, { warned: 1, reclaimed: 0 }, 'already overdue → warned, not taken');
  assert.equal((await heldBy(p)).assignedTo, broker);
  const [w] = await warningsFor(p);
  assert.equal(w.user_id, broker, 'sent to the responsible broker');
  assert.match(w.title, /goes back to the pool in 24 hours$/);
  assert.match(w.body, /No call logged on it for 30 days in Listed offline \(the limit is 7\)/);
  assert.equal(w.read_at, null);

  // Sweeps inside the 24 hours: no second reminder, nothing taken.
  assert.deepEqual(await sweepStaleStages(), { warned: 0, reclaimed: 0 });
  assert.equal((await warningsFor(p)).length, 1);
  // A day later: taken.
  await ageWarnings();
  assert.deepEqual(await sweepStaleStages(), { warned: 0, reclaimed: 1 });
  assert.equal((await heldBy(p)).assignedTo, undefined);
});

test('the reminder goes out 24 hours BEFORE the deadline, not earlier', async () => {
  await wipe(); await saveSettings(rules());
  // Listed offline, 7-day limit: 6.5 days idle → deadline in 12h → warn now.
  const soon = await heldUnit({ stage: PropertyStage.listedOffline, assignedDaysAgo: 6.5, stageDaysAgo: 6.5 });
  // 5.5 days idle → deadline in 36h → not yet.
  const later = await heldUnit({ stage: PropertyStage.listedOffline, assignedDaysAgo: 5.5, stageDaysAgo: 5.5 });
  const r = await sweepStaleStages();
  assert.deepEqual(r, { warned: 1, reclaimed: 0 });
  assert.equal((await warningsFor(soon)).length, 1);
  assert.equal((await warningsFor(later)).length, 0);
});

test('warned on time: it goes back at the deadline itself', async () => {
  await wipe(); await saveSettings(rules());
  // Warned 25h ago (inside its last day), deadline now passed → reclaimed.
  const p = await heldUnit({ stage: PropertyStage.marketAppraisal, assignedDaysAgo: 14.1, stageDaysAgo: 14.1 });
  await insertWarning(p, 25);
  assert.deepEqual(await sweepStaleStages(), { warned: 0, reclaimed: 1 });
});

test('a call after the reminder cancels it; a later lapse gets a fresh reminder', async () => {
  await wipe(); await saveSettings(rules());
  const p = await heldUnit({ stage: PropertyStage.listedOffline, assignedDaysAgo: 30, stageDaysAgo: 30 });
  await sweepStaleStages();               // warned
  await ageWarnings();                    // a day passes…
  await callOn(p, broker, 0.5);           // …and the broker calls (12h ago)
  assert.deepEqual(await sweepStaleStages(), { warned: 0, reclaimed: 0 }, 'kept — fresh 7-day window');
  assert.equal((await heldBy(p)).assignedTo, broker);
  // 7 days later with no call: the OLD reminder doesn't count — a new one goes out first.
  // (Shift the call AND the old reminder back together, keeping their real order.)
  await pool.query('UPDATE calls SET at = DATE_SUB(at, INTERVAL 7 DAY) WHERE org_id = ?', [kOrgId]);
  await pool.query('UPDATE notifications SET created_at = DATE_SUB(created_at, INTERVAL 7 DAY)');
  assert.deepEqual(await sweepStaleStages(), { warned: 1, reclaimed: 0 });
  assert.equal((await warningsFor(p)).length, 2);
});

test('a reminder belongs to its broker: after a take-over, the new broker is warned afresh', async () => {
  await wipe(); await saveSettings(rules());
  const p = await heldUnit({ stage: PropertyStage.listedOffline, assignedDaysAgo: 30, stageDaysAgo: 30 });
  await sweepStaleStages(); await ageWarnings(); // the first broker was warned a day ago
  // Moved to another broker 8 days ago (past the 7-day limit, never warned).
  await pool.query('UPDATE properties SET assigned_to = ?, assigned_at = ? WHERE id = ?', [other, toDb(daysAgo(8)), p.id]);
  assert.deepEqual(await sweepStaleStages(), { warned: 1, reclaimed: 0 }, 'not taken on the old broker’s reminder');
  const ws = await warningsFor(p);
  assert.deepEqual(ws.map(w => w.user_id), [broker, other]);
});

test('notifications API: a broker sees and clears only their own', async () => {
  await wipe(); await saveSettings(rules());
  await heldUnit({ stage: PropertyStage.listedOffline, assignedDaysAgo: 30, stageDaysAgo: 30 });
  await heldUnit({ stage: PropertyStage.listedOffline, assignedDaysAgo: 30, stageDaysAgo: 30, holder: other });
  await sweepStaleStages();
  const asBroker = async (method: 'GET' | 'POST', url: string, payload?: object) => {
    const s = await createSession(broker, {});
    const res = await app.inject({ method, url, headers: { cookie: `${SESSION_COOKIE}=${s.token}`, [CSRF_HEADER]: s.csrfToken }, ...(payload ? { payload } : {}) });
    return { status: res.statusCode, json: JSON.parse(res.body) };
  };
  const list = await asBroker('GET', '/api/notifications');
  assert.equal(list.status, 200);
  assert.equal(list.json.unread, 1, 'only their own unit’s reminder');
  assert.equal(list.json.rows.length, 1);
  assert.ok(list.json.rows[0].propertyId);
  // Marking someone else's id does nothing; "all" clears only mine.
  const [otherRow] = await pool.query<any[]>('SELECT id FROM notifications WHERE user_id = ?', [other]);
  assert.equal((await asBroker('POST', '/api/notifications/read', { ids: [otherRow[0].id] })).json.marked, 0);
  assert.equal((await asBroker('POST', '/api/notifications/read', {})).json.marked, 1);
  assert.equal((await asBroker('GET', '/api/notifications')).json.unread, 0);
  const [still] = await pool.query<any[]>('SELECT read_at FROM notifications WHERE user_id = ?', [other]);
  assert.equal(still[0].read_at, null, 'the other broker’s stays unread');
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
