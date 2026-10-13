import test from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { pool, closePool } from '../src/db/pool';
import { saveProperties, findPropertyById } from '../src/repositories/propertyRepo';
import { insertUser } from '../src/repositories/userRepo';
import { insertRequest } from '../src/repositories/requestRepo';
import { createSession, SESSION_COOKIE, CSRF_HEADER } from '../src/auth/sessions';
import { sweepLapsed } from '../src/services/callService';
import { setOpenAccessForTests } from '../src/domain/access';
import {
  BatchRequest, OwnerInfo, Property, PropertyStage, PropertyState, kOrgId,
} from '../../src/types/models';
import { AppUser, UserRole } from '../../src/types/user';
import { ImportPipeline } from '../../src/logic/importPipeline';
import { newPropertyId, newRequestId, newUserId } from '../src/domain/ids';

/**
 * OPEN ACCESS through the real HTTP layer — the routes, the serializer and the
 * sweep together. The last tests flip back to the assigned model to prove the
 * switch is a clean revert (masking + ownership checks return).
 */

let app: FastifyInstance;
let manager: string, brokerX: string, brokerY: string;
const auth: Record<string, { cookie: string; csrf: string }> = {};

test.before(async () => {
  setOpenAccessForTests(true);
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
  setOpenAccessForTests(null);
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

function unit(n: string, owner: string, phone: string, community = 'Open Hills'): Property {
  const unitKey = ImportPipeline.unitKeyFor({ community, building: 'Tower', unitNumber: n })!;
  const now = new Date().toISOString();
  return new Property(
    newPropertyId(), kOrgId, '', PropertyState.pool, unitKey, community,
    undefined, 'Tower', n, undefined, 'Villa', 4, 2500, undefined, undefined, undefined, 0,
    undefined, undefined, undefined, new OwnerInfo(owner, phone), now, now,
  );
}

/** Pool unit `a`, unit `b` held by broker Y (from before the switch), a cooling and a DNC unit. */
async function seed() {
  await pool.query('DELETE FROM requests WHERE org_id = ?', [kOrgId]);
  await pool.query('DELETE FROM calls WHERE org_id = ?', [kOrgId]);
  await pool.query('DELETE FROM properties WHERE org_id = ?', [kOrgId]);
  const a = unit('1', 'Alpha Owner', '971501112222');
  const b = unit('2', 'Beta Owner', '971503334444');
  b.state = PropertyState.assigned; b.assignedTo = brokerY; b.assignedAt = new Date().toISOString();
  b.assignmentExpiresAt = new Date(Date.now() - 3600_000).toISOString(); // long expired
  const c = unit('3', 'Gamma Owner', '971505556666');
  c.state = PropertyState.cooling; c.cooldownUntil = new Date(Date.now() + 86_400_000).toISOString();
  const d = unit('4', 'Delta Owner', '971507778888');
  d.state = PropertyState.dnc; d.dncAt = new Date().toISOString();
  await saveProperties([a, b, c, d]);
  return { a, b, c, d };
}

const ids = (rows: { id: string }[]) => rows.map(r => r.id).sort();

test('a broker sees the WHOLE vault — other brokers\' units too — with owners and full numbers', async () => {
  const { a, b, c, d } = await seed();

  const toCall = await call(brokerX, 'GET', '/api/properties?scope=mine');
  assert.equal(toCall.status, 200);
  assert.deepEqual(ids(toCall.json.rows), [a.id, b.id].sort(), '"To call": workable units, incl. one held by Y');

  const all = await call(brokerX, 'GET', '/api/properties?scope=mine&includeInactive=true');
  assert.deepEqual(ids(all.json.rows), [a.id, b.id, c.id, d.id].sort(), '"All": cooling + DNC too');

  const rowA = all.json.rows.find((r: { id: string }) => r.id === a.id);
  assert.equal(rowA.owner.name, 'Alpha Owner');
  assert.equal(rowA.owner.phone, '+971 50 111 2222', 'the full number, formatted');
  assert.ok(!String(rowA.owner.phone).includes('•'));
  assert.equal(rowA.stage, PropertyStage.none);

  // A broker asking for scope=all gets the same open set, not a 403 or their own.
  const asAll = await call(brokerX, 'GET', '/api/properties?scope=all&includeInactive=true');
  assert.equal(asAll.json.total, 4);
});

test('the "Open" state filter matches pooled AND legacy-assigned units', async () => {
  const { a, b } = await seed();
  const r = await call(manager, 'GET', '/api/properties?scope=all&state=pool');
  assert.deepEqual(ids(r.json.rows), [a.id, b.id].sort());
});

test('a broker can open, read, call, annotate and update another broker\'s unit', async () => {
  const { b } = await seed();
  assert.equal((await call(brokerX, 'GET', `/api/properties/${b.id}`)).status, 200);
  assert.equal((await call(brokerX, 'GET', `/api/properties/${b.id}/events`)).status, 200);
  assert.equal((await call(brokerX, 'GET', `/api/properties/${b.id}/calls`)).status, 200);
  assert.equal((await call(brokerX, 'GET', `/api/properties/${b.id}/owner-holdings`)).status, 200);
  const ou = await call(brokerX, 'GET', `/api/properties/${b.id}/owner-units`);
  assert.equal(ou.status, 200);
  assert.equal(ou.json.length, 1);

  const logged = await call(brokerX, 'POST', '/api/calls', { propertyIds: [b.id], outcome: 'interestedSell', note: 'keen' });
  assert.equal(logged.status, 200, JSON.stringify(logged.json));
  const after = (await findPropertyById(b.id))!;
  assert.equal(after.state, PropertyState.portfolio, 'interested → Interested');
  assert.equal(after.assignedTo, brokerY, 'the old holder is left as stored — nothing reassigned');

  assert.equal((await call(brokerX, 'PATCH', `/api/properties/${b.id}/notes`, { notes: 'X was here' })).status, 200);
  assert.equal((await call(brokerX, 'POST', `/api/properties/${b.id}/note`, { note: 'viewing booked' })).status, 200);
  assert.equal((await call(brokerX, 'PATCH', `/api/properties/${b.id}/listing`, { askingPrice: 5000000 })).status, 200);
});

test('opening a record is linked to the unit, so the next person can see who opened it', async () => {
  const { a } = await seed();
  assert.equal((await call(brokerX, 'POST', `/api/properties/${a.id}/view`, {})).status, 200);
  const ev = await call(brokerY, 'GET', `/api/properties/${a.id}/events`);
  const open = ev.json.find((e: { kind: string; action?: string; actorId?: string }) =>
    e.kind === 'audit' && e.action === 'view' && e.actorId === brokerX);
  assert.ok(open, 'X\'s open is on the unit\'s event feed');
  assert.match(open.detail, /^Viewed owner detail /, 'a plain open — the popup keeps it out of the visible journal');
});

test('stage: set by anyone, journaled once per real change, validated, filterable and sortable', async () => {
  const { a, b } = await seed();

  const set = await call(brokerX, 'PATCH', `/api/properties/${a.id}/stage`, { stage: PropertyStage.prospecting });
  assert.equal(set.status, 200);
  assert.equal(set.json.stage, PropertyStage.prospecting);
  assert.equal((await findPropertyById(a.id))!.stage, PropertyStage.prospecting);

  // Same stage again → no new journal row.
  await call(brokerY, 'PATCH', `/api/properties/${a.id}/stage`, { stage: PropertyStage.prospecting });
  await call(brokerY, 'PATCH', `/api/properties/${a.id}/stage`, { stage: PropertyStage.listedOnline });
  const [rows] = await pool.query<any[]>(
    `SELECT a.actor_id, a.detail FROM audit a JOIN audit_properties ap ON ap.audit_id = a.id
     WHERE ap.property_id = ? AND a.action = 'stage' ORDER BY a.at`, [a.id],
  );
  assert.deepEqual(rows.map((r: { detail: string }) => r.detail),
    ['Stage: None → Prospecting', 'Stage: Prospecting → Listed online'], 'exactly the two real changes');
  assert.deepEqual(rows.map((r: { actor_id: string }) => r.actor_id), [brokerX, brokerY]);

  // The journal shows it.
  const ev = await call(brokerX, 'GET', `/api/properties/${a.id}/events`);
  assert.ok(ev.json.some((e: { action?: string; detail?: string }) => e.action === 'stage' && e.detail === 'Stage: Prospecting → Listed online'));

  // Validation.
  assert.equal((await call(brokerX, 'PATCH', `/api/properties/${a.id}/stage`, { stage: 'sold' })).status, 400);
  assert.equal((await call(brokerX, 'PATCH', `/api/properties/${a.id}/stage`, {})).status, 400);
  assert.equal((await call(brokerX, 'PATCH', '/api/properties/nope/stage', { stage: PropertyStage.none })).status, 404);

  // Filter + sort.
  await call(manager, 'PATCH', `/api/properties/${b.id}/stage`, { stage: PropertyStage.marketAppraisal });
  const f = await call(manager, 'GET', `/api/properties?scope=all&stage=${PropertyStage.listedOnline}`);
  assert.deepEqual(ids(f.json.rows), [a.id]);
  const sorted = await call(manager, 'GET', '/api/properties?scope=all&includeInactive=true&sortKey=stage&asc=false');
  assert.deepEqual(sorted.json.rows.slice(0, 2).map((r: { id: string }) => r.id), [a.id, b.id], 'journey order, latest first');
});

test('stage survives the import / call-logging upsert (it is never written by saveProperties)', async () => {
  const { a } = await seed();
  await call(brokerX, 'PATCH', `/api/properties/${a.id}/stage`, { stage: PropertyStage.listedOffline });
  const p = (await findPropertyById(a.id))!;
  p.stage = PropertyStage.none;         // a re-import builds the record afresh
  p.owner.name = 'Alpha Owner (updated)';
  await saveProperties([p]);
  const back = (await findPropertyById(a.id))!;
  assert.equal(back.owner.name, 'Alpha Owner (updated)');
  assert.equal(back.stage, PropertyStage.listedOffline);
  // And a logged call doesn't touch it either.
  await call(brokerX, 'POST', '/api/calls', { propertyIds: [a.id], outcome: 'noAnswer' });
  assert.equal((await findPropertyById(a.id))!.stage, PropertyStage.listedOffline);
});

test('assignment + request endpoints are refused, and change nothing', async () => {
  const { a, b } = await seed();
  const req = new BatchRequest(newRequestId(), kOrgId, brokerX, 'Open Hills', undefined, 1, [a.id], undefined, new Date().toISOString());
  await insertRequest(req);

  const refused = [
    await call(manager, 'POST', '/api/properties/assign', { propertyIds: [a.id], brokerId: brokerX }),
    await call(manager, 'POST', '/api/properties/assign/preview', { propertyIds: [a.id], brokerId: brokerX }),
    await call(manager, 'POST', '/api/properties/reclaim', { propertyIds: [b.id] }),
    await call(brokerX, 'POST', '/api/requests', { community: 'Open Hills', count: 1, unitIds: [a.id] }),
    await call(manager, 'POST', `/api/requests/${req.id}/approve`),
    await call(manager, 'POST', `/api/requests/${req.id}/deny`),
    await call(manager, 'POST', `/api/requests/${req.id}/units/decide`, { action: 'approve', unitIds: [a.id] }),
    await call(manager, 'POST', `/api/users/${brokerY}/deactivate`, { mode: 'reclaim' }),
  ];
  for (const r of refused) {
    assert.equal(r.status, 409, JSON.stringify(r.json));
    assert.equal(r.json.error.code, 'assignments_off');
  }
  assert.equal((await findPropertyById(a.id))!.state, PropertyState.pool);
  assert.equal((await findPropertyById(b.id))!.assignedTo, brokerY);
  const [rq] = await pool.query<any[]>('SELECT status FROM requests WHERE id = ?', [req.id]);
  assert.equal(rq[0].status, 'pending', 'the request is left exactly as it was');
  const [u] = await pool.query<any[]>('SELECT active FROM users WHERE id = ?', [brokerY]);
  assert.equal(Number(u[0].active), 1, 'a refused deactivation did not deactivate');
});

test('the sweep never returns a held unit on its timer, but a finished cooldown still comes back', async () => {
  const { b, c } = await seed();
  await pool.query(
    'UPDATE properties SET cooldown_until = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 HOUR) WHERE id = ?', [c.id]);
  await sweepLapsed();
  const held = (await findPropertyById(b.id))!;
  assert.equal(held.state, PropertyState.assigned, 'expired deadline ignored');
  assert.equal(held.assignedTo, brokerY);
  const cooled = (await findPropertyById(c.id))!;
  assert.equal(cooled.state, PropertyState.pool, 'cooldown over → back');
  const [rows] = await pool.query<any[]>(
    "SELECT detail FROM audit WHERE action = 'reclaim' AND detail = 'Back in the pool (cooldown ended)'");
  assert.ok(rows.length >= 1);
});

// ── Back to the assigned model: the revert path ───────────────────────────────

test('REVERT: switched off, numbers are masked and other brokers\' units are refused again', async () => {
  const { a, b } = await seed();
  setOpenAccessForTests(false);
  try {
    const mine = await call(brokerX, 'GET', '/api/properties?scope=mine&includeInactive=true');
    assert.equal(mine.json.total, 0, 'X holds nothing');
    assert.equal((await call(brokerX, 'GET', `/api/properties/${b.id}`)).status, 403);
    assert.equal((await call(brokerX, 'POST', '/api/calls', { propertyIds: [b.id], outcome: 'noAnswer' })).status, 403);
    assert.equal((await call(brokerX, 'PATCH', `/api/properties/${b.id}/stage`, { stage: PropertyStage.prospecting })).status, 403);
    const asY = await call(brokerY, 'GET', `/api/properties/${b.id}`);
    assert.equal(asY.status, 200);
    assert.match(asY.json.owner.phone, /^•+4444$/, 'masked again');
    assert.equal((await call(brokerY, 'PATCH', `/api/properties/${b.id}/stage`, { stage: PropertyStage.prospecting })).status, 200);
    const assign = await call(manager, 'POST', '/api/properties/assign', { propertyIds: [a.id], brokerId: brokerX });
    assert.equal(assign.status, 200, 'assignment works again');
  } finally {
    setOpenAccessForTests(true);
  }
});

test('REVERT: the sweep recycles an UNASSIGNED cooled unit (no empty IN () crash)', async () => {
  const { c } = await seed();
  await pool.query(
    'UPDATE properties SET cooldown_until = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 HOUR) WHERE id = ?', [c.id]);
  setOpenAccessForTests(false);
  try {
    await sweepLapsed(); // used to throw: the broker list was empty
    assert.equal((await findPropertyById(c.id))!.state, PropertyState.pool);
  } finally {
    setOpenAccessForTests(true);
  }
});
