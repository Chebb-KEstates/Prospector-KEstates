import test from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { pool, closePool } from '../src/db/pool';
import { saveProperties, findPropertyById } from '../src/repositories/propertyRepo';
import { findRequestById } from '../src/repositories/requestRepo';
import { insertUser } from '../src/repositories/userRepo';
import { createSession, SESSION_COOKIE, CSRF_HEADER } from '../src/auth/sessions';
import { approveRequest, denyRequest, decideRequestUnits } from '../src/services/assignmentService';
import { setOpenViewForTests } from '../src/domain/access';
import {
  OwnerInfo, Property, PropertyStage, PropertyState, RequestKind, RequestStatus, UnitDecision, kOrgId,
} from '../../src/types/models';
import { AppUser, UserRole } from '../../src/types/user';
import { ImportPipeline } from '../../src/logic/importPipeline';
import { newPropertyId, newUserId } from '../src/domain/ids';

/**
 * OPEN VIEW through the real HTTP layer: every broker can SEE every unit (owner
 * + full number), but only its broker or a manager can WORK it; anyone else asks
 * for it — a take-over request that, once approved, moves the unit. A broker's
 * journal never shows stage changes, record opens or reveals. The last tests
 * switch open view off to prove the revert path.
 */

let app: FastifyInstance;
let manager: string, brokerX: string, brokerY: string;
const auth: Record<string, { cookie: string; csrf: string }> = {};

test.before(async () => {
  setOpenViewForTests(true);
  manager = newUserId(); brokerX = newUserId(); brokerY = newUserId();
  const mk = (id: string, name: string, role: UserRole) => insertUser({
    user: new AppUser(id, name, `${id}@test.local`, role, true, 'QA', undefined, new Date().toISOString()),
    passwordHash: 'scrypt$131072$8$1$AAAA$AAAA', mustChangePassword: false,
  });
  await mk(manager, 'Manager', UserRole.manager);
  await mk(brokerX, 'Broker X', UserRole.broker);
  await mk(brokerY, 'Broker Y', UserRole.broker);
  for (const id of [manager, brokerX, brokerY]) {
    const s = await createSession(id, {});
    auth[id] = { cookie: `${SESSION_COOKIE}=${s.token}`, csrf: s.csrfToken };
  }
  app = await buildApp();
  await app.ready();
});

test.after(async () => {
  setOpenViewForTests(null);
  await app.close();
  await closePool();
});

async function call(who: string, method: 'GET' | 'POST' | 'PATCH', url: string, body?: unknown) {
  const res = await app.inject({
    method, url,
    headers: { cookie: auth[who].cookie, [CSRF_HEADER]: auth[who].csrf },
    ...(body !== undefined ? { payload: body as object } : {}),
  });
  return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null };
}

function unit(n: string, owner: string, phone: string, community = 'View Hills'): Property {
  const unitKey = ImportPipeline.unitKeyFor({ community, building: 'Tower', unitNumber: n })!;
  const now = new Date().toISOString();
  return new Property(
    newPropertyId(), kOrgId, '', PropertyState.pool, unitKey, community,
    undefined, 'Tower', n, undefined, 'Villa', 4, 2500, undefined, undefined, undefined, 0,
    undefined, undefined, undefined, new OwnerInfo(owner, phone), now, now,
  );
}
const hold = (p: Property, broker: string) => {
  p.state = PropertyState.assigned; p.assignedTo = broker; p.assignedAt = new Date().toISOString();
};

/** y1 + y2: one owner, same area, both with broker Y. x1: with X. pool1: pooled. dnc1: do-not-call. */
async function seed() {
  await pool.query('DELETE FROM requests WHERE org_id = ?', [kOrgId]);
  await pool.query('DELETE FROM calls WHERE org_id = ?', [kOrgId]);
  await pool.query('DELETE FROM properties WHERE org_id = ?', [kOrgId]);
  const y1 = unit('1', 'Yara Owner', '971501112222'); hold(y1, brokerY);
  const y2 = unit('2', 'Yara Owner', '971501112222'); hold(y2, brokerY);
  const x1 = unit('3', 'Xavi Owner', '971503334444'); hold(x1, brokerX);
  const pool1 = unit('4', 'Pia Owner', '971505556666');
  const dnc1 = unit('5', 'Dana Owner', '971507778888'); dnc1.state = PropertyState.dnc; dnc1.dncAt = new Date().toISOString();
  await saveProperties([y1, y2, x1, pool1, dnc1]);
  return { y1, y2, x1, pool1, dnc1 };
}
const ids = (rows: { id: string }[]) => rows.map(r => r.id).sort();

test('a broker can SEE every unit — owner + full number — via scope=all; "mine" is still their own', async () => {
  const { y1, y2, x1, pool1, dnc1 } = await seed();
  const all = await call(brokerX, 'GET', '/api/properties?scope=all');
  assert.equal(all.status, 200);
  assert.deepEqual(ids(all.json.rows), [y1.id, y2.id, x1.id, pool1.id, dnc1.id].sort());
  const rowY = all.json.rows.find((r: { id: string }) => r.id === y1.id);
  assert.equal(rowY.owner.name, 'Yara Owner');
  assert.equal(rowY.owner.phone, '+971 50 111 2222');
  assert.equal(rowY.assignedTo, brokerY, 'the responsible broker is shown');

  const mine = await call(brokerX, 'GET', '/api/properties?scope=mine');
  assert.deepEqual(ids(mine.json.rows), [x1.id]);

  const poolView = await call(brokerX, 'GET', '/api/properties?scope=pool');
  assert.equal(poolView.json.rows[0].owner.name, 'Pia Owner', 'the pool shows owners under open view');

  assert.equal((await call(brokerX, 'GET', `/api/properties/${y1.id}`)).status, 200);
  assert.equal((await call(brokerX, 'GET', `/api/properties/${y1.id}/events`)).status, 200);
  assert.equal((await call(brokerX, 'GET', `/api/properties/${y1.id}/calls`)).status, 200);
  assert.equal((await call(brokerX, 'GET', `/api/properties/${y1.id}/owner-holdings`)).status, 200);
});

test('anyone may LOG on a unit (call, notes, update) — only its broker or a manager changes stage / listing', async () => {
  const { y1 } = await seed();
  const allowed = [
    await call(brokerX, 'POST', '/api/calls', { propertyIds: [y1.id], outcome: 'noAnswer', note: 'tried' }),
    await call(brokerX, 'PATCH', `/api/properties/${y1.id}/notes`, { notes: 'X was here' }),
    await call(brokerX, 'POST', `/api/properties/${y1.id}/note`, { note: 'update from X' }),
  ];
  for (const r of allowed) assert.equal(r.status, 200, JSON.stringify(r.json));
  const refused = [
    await call(brokerX, 'PATCH', `/api/properties/${y1.id}/listing`, { askingPrice: 1 }),
    await call(brokerX, 'PATCH', `/api/properties/${y1.id}/stage`, { stage: PropertyStage.prospecting }),
  ];
  for (const r of refused) assert.equal(r.status, 403, JSON.stringify(r.json));
  const after = (await findPropertyById(y1.id))!;
  assert.equal(after.callAttempts, 1, 'X\'s call counted on the unit');
  assert.equal(after.notes, 'X was here');
  assert.equal(after.stage, PropertyStage.none);
  assert.equal(after.askingPrice, undefined);
  assert.equal(after.assignedTo, brokerY, 'logging never moves ownership');
  // The call is X's own (counts for X, shows as X in the journal).
  const [calls] = await pool.query<any[]>('SELECT broker_id FROM calls WHERE org_id = ? ORDER BY at DESC LIMIT 1', [kOrgId]);
  assert.equal(calls[0].broker_id, brokerX);

  // Its broker and a manager can.
  assert.equal((await call(brokerY, 'POST', '/api/calls', { propertyIds: [y1.id], outcome: 'noAnswer' })).status, 200);
  assert.equal((await call(brokerY, 'PATCH', `/api/properties/${y1.id}/stage`, { stage: PropertyStage.prospecting })).status, 200);
  assert.equal((await call(manager, 'PATCH', `/api/properties/${y1.id}/stage`, { stage: PropertyStage.marketAppraisal })).status, 200);
  assert.equal((await call(manager, 'POST', `/api/properties/${y1.id}/note`, { note: 'checked' })).status, 200);
  // A pooled unit can be called too, but its stage is a manager's (nobody owns it).
  const { pool1 } = await seed();
  assert.equal((await call(brokerX, 'POST', '/api/calls', { propertyIds: [pool1.id], outcome: 'noAnswer' })).status, 200);
  assert.equal((await call(brokerX, 'PATCH', `/api/properties/${pool1.id}/stage`, { stage: PropertyStage.prospecting })).status, 403);
  assert.equal((await findPropertyById(pool1.id))!.state, PropertyState.pool, 'a no-answer leaves it in the pool');
});

test('a broker\'s journal has no stage changes, record opens or reveals — a manager\'s has them all', async () => {
  const { y1 } = await seed();
  await call(brokerY, 'PATCH', `/api/properties/${y1.id}/stage`, { stage: PropertyStage.listedOnline });
  await call(brokerX, 'POST', `/api/properties/${y1.id}/view`, {});
  await call(brokerY, 'POST', `/api/properties/${y1.id}/reveal`, {});
  await call(brokerY, 'POST', `/api/properties/${y1.id}/note`, { note: 'viewing booked' });

  const actions = (j: { kind: string; action?: string }[]) => j.filter(e => e.kind === 'audit').map(e => e.action).sort();
  for (const b of [brokerX, brokerY]) {
    const ev = await call(b, 'GET', `/api/properties/${y1.id}/events`);
    assert.deepEqual(actions(ev.json), ['note'], 'only the real work');
  }
  const mgr = await call(manager, 'GET', `/api/properties/${y1.id}/events`);
  assert.deepEqual(actions(mgr.json), ['note', 'stage', 'view', 'view']);
});

test('request ownership: take-over for another broker\'s unit, ordinary for a pooled one, refused otherwise', async () => {
  const { y1, x1, pool1, dnc1 } = await seed();

  const t = await call(brokerX, 'POST', `/api/properties/${y1.id}/request-ownership`, {});
  assert.equal(t.status, 200, JSON.stringify(t.json));
  assert.equal(t.json.kind, RequestKind.takeover);
  assert.deepEqual(t.json.unitIds, [y1.id]);
  assert.equal(t.json.note, 'Take over from Broker Y');
  assert.equal(t.json.status, RequestStatus.pending);

  const again = await call(brokerX, 'POST', `/api/properties/${y1.id}/request-ownership`, {});
  assert.equal(again.status, 409, 'no duplicate while the first waits');

  const p = await call(brokerX, 'POST', `/api/properties/${pool1.id}/request-ownership`, {});
  assert.equal(p.status, 200);
  assert.equal(p.json.kind, RequestKind.units);

  assert.equal((await call(brokerX, 'POST', `/api/properties/${x1.id}/request-ownership`, {})).status, 400, 'already yours');
  assert.equal((await call(brokerX, 'POST', `/api/properties/${dnc1.id}/request-ownership`, {})).status, 400, 'do not call');
  assert.equal((await call(manager, 'POST', `/api/properties/${y1.id}/request-ownership`, {})).status, 400, 'managers reassign');
  assert.equal((await call(brokerX, 'POST', '/api/properties/nope/request-ownership', {})).status, 404);

  // The broker sees their requests; the manager sees them in the list with kind.
  const list = await call(manager, 'GET', '/api/requests');
  const kinds = list.json.map((r: { kind: string }) => r.kind).sort();
  assert.deepEqual(kinds, [RequestKind.takeover, RequestKind.units]);
  // Nothing moved yet.
  assert.equal((await findPropertyById(y1.id))!.assignedTo, brokerY);
});

test('approving a take-over moves the unit — and the owner\'s same-area units — to the requester', async () => {
  const { y1, y2 } = await seed();
  const t = await call(brokerX, 'POST', `/api/properties/${y1.id}/request-ownership`, {});
  const r = await approveRequest(t.json.id, manager);
  assert.equal(r.granted, 1);
  assert.equal(r.request.status, RequestStatus.approved);
  for (const u of [y1, y2]) {
    const after = (await findPropertyById(u.id))!;
    assert.equal(after.assignedTo, brokerX, `${u.unitNumber} moved to X`);
    assert.equal(after.state, PropertyState.assigned);
  }
  const back = (await findRequestById(t.json.id))!;
  assert.equal(back.unitDecisions[y1.id], UnitDecision.granted);
  // X now owns it (stage is X's to change); Y can still log on it, but not manage it.
  assert.equal((await call(brokerX, 'PATCH', `/api/properties/${y1.id}/stage`, { stage: PropertyStage.prospecting })).status, 200);
  assert.equal((await call(brokerY, 'PATCH', `/api/properties/${y1.id}/stage`, { stage: PropertyStage.listedOnline })).status, 403);
  // The move is on the audit trail.
  const [rows] = await pool.query<any[]>(
    `SELECT a.detail FROM audit a JOIN audit_properties ap ON ap.audit_id = a.id
      WHERE ap.property_id = ? AND a.action = 'assign'`, [y1.id]);
  assert.ok(rows.some((x: { detail: string }) => /Assigned to Broker X/.test(x.detail)));
});

test('denying a take-over leaves the unit with its broker; per-unit decide works too', async () => {
  const { y1 } = await seed();
  const t = await call(brokerX, 'POST', `/api/properties/${y1.id}/request-ownership`, {});
  const d = await denyRequest(t.json.id, manager);
  assert.equal(d.status, RequestStatus.denied);
  assert.equal((await findPropertyById(y1.id))!.assignedTo, brokerY);

  // Asking again after a denial is allowed, and the popup's per-unit approve works.
  const t2 = await call(brokerX, 'POST', `/api/properties/${y1.id}/request-ownership`, {});
  assert.equal(t2.status, 200);
  const r = await decideRequestUnits(t2.json.id, [y1.id], 'approve', manager);
  assert.equal(r.granted, 1);
  assert.equal((await findPropertyById(y1.id))!.assignedTo, brokerX);
});

test('a take-over approved after the unit went do-not-call is not handed over', async () => {
  const { y1 } = await seed();
  const t = await call(brokerX, 'POST', `/api/properties/${y1.id}/request-ownership`, {});
  await pool.query(`UPDATE properties SET state = 'dnc' WHERE id = ?`, [y1.id]);
  const r = await approveRequest(t.json.id, manager);
  assert.equal(r.granted, 0);
  const after = (await findPropertyById(y1.id))!;
  assert.equal(after.state, PropertyState.dnc);
  assert.equal(after.assignedTo, brokerY);
  assert.equal((await findRequestById(t.json.id))!.unitDecisions[y1.id], UnitDecision.unavailable);
});

test('a take-over still lands if the unit was reclaimed to the pool meanwhile', async () => {
  const { y1 } = await seed();
  const t = await call(brokerX, 'POST', `/api/properties/${y1.id}/request-ownership`, {});
  await call(manager, 'POST', '/api/properties/reclaim', { propertyIds: [y1.id] });
  assert.equal((await findPropertyById(y1.id))!.state, PropertyState.pool);
  const r = await approveRequest(t.json.id, manager);
  assert.equal(r.granted, 1);
  assert.equal((await findPropertyById(y1.id))!.assignedTo, brokerX);
});

test('assignments, reclaim and pool requests work as normal', async () => {
  const { pool1, x1 } = await seed();
  assert.equal((await call(manager, 'POST', '/api/properties/assign', { propertyIds: [pool1.id], brokerId: brokerY })).status, 200);
  assert.equal((await findPropertyById(pool1.id))!.assignedTo, brokerY);
  assert.equal((await call(manager, 'POST', '/api/properties/reclaim', { propertyIds: [x1.id] })).status, 200);
  assert.equal((await findPropertyById(x1.id))!.state, PropertyState.pool);
});

// ── Open view off: the revert path ────────────────────────────────────────────

test('REVERT: off, another broker\'s unit is hidden again, numbers masked, take-over refused', async () => {
  const { y1, x1, pool1 } = await seed();
  setOpenViewForTests(false);
  try {
    assert.equal((await call(brokerX, 'GET', `/api/properties/${y1.id}`)).status, 403);
    assert.equal((await call(brokerX, 'GET', `/api/properties/${y1.id}/events`)).status, 403);
    assert.equal((await call(brokerX, 'POST', '/api/calls', { propertyIds: [y1.id], outcome: 'noAnswer' })).status, 403);
    assert.equal((await call(brokerX, 'POST', `/api/properties/${y1.id}/note`, { note: 'x' })).status, 403);
    const all = await call(brokerX, 'GET', '/api/properties?scope=all&includeInactive=true');
    assert.deepEqual(ids(all.json.rows), [x1.id], 'scope=all falls back to their own');
    assert.match(all.json.rows[0].owner.phone, /^•+4444$/);
    const poolView = await call(brokerX, 'GET', '/api/properties?scope=pool');
    assert.equal(poolView.json.rows[0].owner.name, '', 'pool teaser again');
    assert.equal((await call(brokerX, 'POST', `/api/properties/${y1.id}/request-ownership`, {})).status, 403);
    assert.equal((await call(brokerX, 'POST', `/api/properties/${pool1.id}/request-ownership`, {})).status, 200,
      'a pooled unit can still be requested');
  } finally {
    setOpenViewForTests(true);
  }
});
