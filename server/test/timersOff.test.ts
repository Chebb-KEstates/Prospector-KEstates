import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { pool, closePool } from '../src/db/pool';
import { saveProperties, findPropertyById, countExpiringSoon, countStalePortfolio } from '../src/repositories/propertyRepo';
import { loadSettings, saveSettings } from '../src/repositories/settingsRepo';
import { insertUser } from '../src/repositories/userRepo';
import { createSession, SESSION_COOKIE, CSRF_HEADER } from '../src/auth/sessions';
import { sweepLapsed } from '../src/services/callService';
import { CallOutcome, OwnerInfo, Property, PropertyState, VaultSettings, kOrgId } from '../../src/types/models';
import { AppUser, UserRole } from '../../src/types/user';
import { ImportPipeline } from '../../src/logic/importPipeline';
import { newPropertyId, newUserId } from '../src/domain/ids';

/**
 * A setting of 0 switches that rule OFF — cooldowns, hold timers, staleness and
 * the "running out of time" alert. Off means off: the sweep leaves units alone
 * even when they still carry a deadline from before the switch.
 */

let app: FastifyInstance;
let manager: string, broker: string;
let auth: { cookie: string; csrf: string };
let original: VaultSettings;

const OFF = () => new VaultSettings(0, 0, 3, 14, 0, '', 0, 0, 0, 0, 0);
const hourAgo = () => new Date(Date.now() - 3600_000).toISOString();
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

test.before(async () => {
  original = await loadSettings();
  manager = newUserId(); broker = newUserId();
  const mk = (id: string, name: string, role: UserRole) => insertUser({
    user: new AppUser(id, name, `${id}@test.local`, role, true, 'QA', undefined, new Date().toISOString()),
    passwordHash: 'scrypt$131072$8$1$AAAA$AAAA', mustChangePassword: false,
  });
  await mk(manager, 'Manager', UserRole.manager);
  await mk(broker, 'Broker', UserRole.broker);
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

function unit(n: string, owner = `Owner ${n}`, phone = `97150000${n.padStart(4, '0')}`): Property {
  const community = 'Timer Park';
  const unitKey = ImportPipeline.unitKeyFor({ community, building: 'T', unitNumber: n })!;
  const now = new Date().toISOString();
  return new Property(
    newPropertyId(), kOrgId, '', PropertyState.pool, unitKey, community,
    undefined, 'T', n, undefined, 'Villa', 3, 2000, undefined, undefined, undefined, 0,
    undefined, undefined, undefined, new OwnerInfo(owner, phone), now, now,
  );
}

async function wipe() {
  await pool.query('DELETE FROM calls WHERE org_id = ?', [kOrgId]);
  await pool.query('DELETE FROM properties WHERE org_id = ?', [kOrgId]);
}

/** An assigned unit whose deadline passed, an interested one likewise, and a cooled one whose cooldown passed. */
async function seedDue() {
  await wipe();
  const held = unit('1'); held.state = PropertyState.assigned; held.assignedTo = broker;
  held.assignedAt = daysAgo(3); held.assignmentExpiresAt = hourAgo();
  const kept = unit('2'); kept.state = PropertyState.portfolio; kept.assignedTo = broker;
  kept.assignedAt = daysAgo(3); kept.portfolioSince = daysAgo(30); kept.lastCalledAt = daysAgo(30);
  kept.assignmentExpiresAt = hourAgo();
  const cooled = unit('3'); cooled.state = PropertyState.cooling; cooled.assignedTo = broker;
  cooled.lastOutcome = CallOutcome.notInterested; cooled.cooldownUntil = hourAgo();
  const listed = unit('4'); listed.state = PropertyState.cooling;
  listed.lastOutcome = CallOutcome.alreadyListed; listed.cooldownUntil = hourAgo();
  await saveProperties([held, kept, cooled, listed]);
  return { held, kept, cooled, listed };
}

test('the Settings API accepts 0 for every timer, cooldown and alert', async () => {
  const res = await app.inject({
    method: 'PATCH', url: '/api/settings',
    headers: { cookie: auth.cookie, [CSRF_HEADER]: auth.csrf },
    payload: {
      notInterestedCooldownDays: 0, listedCooldownDays: 0, portfolioStaleDays: 0,
      assignmentSlaHours: 0, noAnswerExtensionHours: 0, noAnswerMaxHoldDays: 0,
      portfolioRenewDays: 0, expiringSoonHours: 0,
    },
  });
  assert.equal(res.statusCode, 200, res.body);
  const s = await loadSettings();
  for (const k of ['notInterestedCooldownDays', 'listedCooldownDays', 'portfolioStaleDays', 'assignmentSlaHours',
    'noAnswerExtensionHours', 'noAnswerMaxHoldDays', 'portfolioRenewDays', 'expiringSoonHours'] as const) {
    assert.equal(s[k], 0, k);
  }
});

test('migration 018 sets every one of those numbers to 0 and nothing else', async () => {
  await saveSettings(new VaultSettings(30, 7, 3, 14, 10, '10.0.0.1', 168, 168, 5, 7, 24));
  const sql = fs.readFileSync(path.resolve(__dirname, '../src/db/migrations/018_timers_off.sql'), 'utf8')
    .split('\n').filter(l => !l.trim().startsWith('--')).join('\n').trim().replace(/;\s*$/, '');
  await pool.query(sql);
  const s = await loadSettings();
  assert.deepEqual(
    [s.notInterestedCooldownDays, s.listedCooldownDays, s.portfolioStaleDays, s.assignmentSlaHours,
      s.noAnswerExtensionHours, s.noAnswerMaxHoldDays, s.portfolioRenewDays, s.expiringSoonHours],
    [0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(s.officeIp, '10.0.0.1', 'unrelated settings untouched');
  assert.equal(s.maxNoAnswerAttempts, 3);
});

test('all off: the sweep releases nothing — even units with an old, passed deadline', async () => {
  await saveSettings(OFF());
  const { held, kept, cooled, listed } = await seedDue();
  await sweepLapsed();
  assert.equal((await findPropertyById(held.id))!.state, PropertyState.assigned);
  assert.equal((await findPropertyById(held.id))!.assignedTo, broker);
  assert.equal((await findPropertyById(kept.id))!.state, PropertyState.portfolio);
  assert.equal((await findPropertyById(cooled.id))!.state, PropertyState.cooling);
  assert.equal((await findPropertyById(listed.id))!.state, PropertyState.cooling);
  // The old deadlines are kept, untouched.
  assert.ok((await findPropertyById(held.id))!.assignmentExpiresAt);
  assert.equal(await countExpiringSoon(24, undefined, OFF()), 0, 'no "running out of time" while hold timers are off');
  assert.equal(await countStalePortfolio(0), 0, 'staleness off');
});

test('turned back on, the same units are released as before', async () => {
  await saveSettings(new VaultSettings());
  const { held, kept, cooled, listed } = await seedDue();
  await sweepLapsed();
  for (const u of [held, kept, cooled, listed]) {
    assert.equal((await findPropertyById(u.id))!.state, PropertyState.pool, `unit ${u.unitNumber}`);
  }
});

test('each switch is independent: only the rule set to 0 stops', async () => {
  // Cooldowns on, hold timers off.
  await saveSettings(new VaultSettings(30, 30, 3, 14, 21, '', 0, 0, 0, 0, 24));
  const { held, kept, cooled, listed } = await seedDue();
  await sweepLapsed();
  assert.equal((await findPropertyById(held.id))!.state, PropertyState.assigned);
  assert.equal((await findPropertyById(kept.id))!.state, PropertyState.portfolio);
  assert.equal((await findPropertyById(listed.id))!.state, PropertyState.pool, 'listed cooldown on → back');

  // "Already listed" off but "not interested" on.
  await saveSettings(new VaultSettings(30, 0, 3, 14, 21, '', 48, 24, 14, 7, 24));
  const again = await seedDue();
  await sweepLapsed();
  assert.equal((await findPropertyById(again.listed.id))!.state, PropertyState.cooling, 'listed off → stays');
  assert.equal((await findPropertyById(again.cooled.id))!.state, PropertyState.pool, 'not-interested on → back');
  void cooled;
});

test('a due cooldown never drags back an owner\'s held units whose timer is off', async () => {
  // One owner, same area, same broker: a cooled unit (cooldown on, due) and an
  // assigned sibling with an old passed deadline (hold timer OFF).
  await saveSettings(new VaultSettings(30, 30, 3, 14, 21, '', 0, 0, 0, 0, 24));
  await wipe();
  const a = unit('10', 'Same Owner', '971509990000');
  a.state = PropertyState.cooling; a.assignedTo = broker; a.lastOutcome = CallOutcome.notInterested; a.cooldownUntil = hourAgo();
  const b = unit('11', 'Same Owner', '971509990000');
  b.state = PropertyState.assigned; b.assignedTo = broker; b.assignedAt = daysAgo(3); b.assignmentExpiresAt = hourAgo();
  await saveProperties([a, b]);
  await sweepLapsed();
  const bAfter = (await findPropertyById(b.id))!;
  assert.equal(bAfter.state, PropertyState.assigned, 'the held sibling stays with its broker');
  assert.equal(bAfter.assignedTo, broker);
});
