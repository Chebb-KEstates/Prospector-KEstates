import test from 'node:test';
import assert from 'node:assert/strict';
import { pool, closePool } from '../src/db/pool';
import { revealOwnerPhone } from '../src/services/revealService';
import { insertUser } from '../src/repositories/userRepo';
import { saveProperties } from '../src/repositories/propertyRepo';
import { AppUser, UserRole } from '../../src/types/user';
import { Property, OwnerInfo, PropertyState, kOrgId } from '../../src/types/models';
import { ImportPipeline } from '../../src/logic/importPipeline';
import { newPropertyId, newUserId } from '../src/domain/ids';

/** The reveal is the only door a real phone number leaves by. These guard it. */

let brokerId: string;
let managerId: string;
let propertyId: string;

async function countAudit(actorId: string, action: string): Promise<number> {
  const [rows] = await pool.query<any[]>(
    'SELECT COUNT(*) AS n FROM audit WHERE actor_id = ? AND action = ?', [actorId, action],
  );
  return Number(rows[0].n);
}

function broker(cap?: number): AppUser {
  return new AppUser(brokerId, 'Cap Broker', `cap-${brokerId}@test.local`,
    UserRole.broker, true, '', undefined, cap, new Date().toISOString());
}

test.before(async () => {
  brokerId = newUserId();
  managerId = newUserId();
  await insertUser({
    user: broker(2),
    passwordHash: 'scrypt$131072$8$1$AAAA$AAAA', mustChangePassword: false,
  });
  await insertUser({
    user: new AppUser(managerId, 'Cap Manager', `capmgr-${managerId}@test.local`,
      UserRole.manager, true, '', undefined, undefined, new Date().toISOString()),
    passwordHash: 'scrypt$131072$8$1$AAAA$AAAA', mustChangePassword: false,
  });

  const now = new Date().toISOString();
  const unitKey = ImportPipeline.unitKeyFor({
    community: 'Cap Community', building: 'T9', unitNumber: '901',
  })!;
  const p = new Property(
    newPropertyId(), kOrgId, '', PropertyState.assigned, unitKey, 'Cap Community',
    undefined, 'T9', '901', undefined, 'Villa', 3, 2000, undefined,
    undefined, undefined, 0, undefined, undefined, undefined,
    new OwnerInfo('Reveal Target', '971509998888', 'UAE'), now, now,
  );
  p.assignedTo = brokerId;
  await saveProperties([p]);
  propertyId = p.id;
});

async function resetViews() {
  await pool.query(
    `DELETE FROM audit WHERE actor_id = ? AND action IN ('view','cap-block')`, [brokerId],
  );
}

test('reveal returns the grouped number and audits it', async () => {
  await resetViews();
  const r = await revealOwnerPhone(propertyId, {
    user: broker(2), tzOffsetMinutes: 0, enforceCap: true,
  });

  assert.equal(r.phone, '+971 50 999 8888', 'grouped exactly as prettyPhone rendered before');
  assert.equal(r.used, 1);
  assert.equal(r.cap, 2);
  assert.equal(await countAudit(brokerId, 'view'), 1);
});

test('the cap blocks past the limit', async () => {
  await resetViews();
  const me = broker(2);
  await revealOwnerPhone(propertyId, { user: me, tzOffsetMinutes: 0, enforceCap: true });
  await revealOwnerPhone(propertyId, { user: me, tzOffsetMinutes: 0, enforceCap: true });

  await assert.rejects(
    () => revealOwnerPhone(propertyId, { user: me, tzOffsetMinutes: 0, enforceCap: true }),
    (err: any) => err.code === 'view_cap_reached' && err.statusCode === 429,
  );
});

test('REGRESSION: a blocked reveal is still audited', async () => {
  // The cap-block entry was originally written inside the same transaction as
  // the throw that signals the block — so the rollback erased it, and hitting
  // the cap left no trace at all. Commit the decision, then throw.
  await resetViews();
  const me = broker(1);
  await revealOwnerPhone(propertyId, { user: me, tzOffsetMinutes: 0, enforceCap: true });

  await assert.rejects(
    () => revealOwnerPhone(propertyId, { user: me, tzOffsetMinutes: 0, enforceCap: true }),
  );

  assert.equal(await countAudit(brokerId, 'cap-block'), 1, 'the block must be recorded');
  assert.equal(await countAudit(brokerId, 'view'), 1, 'and must not count as a view');
});

test('a manager is exempt from the cap', async () => {
  const mgr = new AppUser(managerId, 'Cap Manager', `capmgr-${managerId}@test.local`,
    UserRole.manager, true, '', undefined, undefined, new Date().toISOString());
  await pool.query(
    `DELETE FROM audit WHERE actor_id = ? AND action IN ('view','cap-block')`, [managerId],
  );
  for (let i = 0; i < 5; i++) {
    await revealOwnerPhone(propertyId, { user: mgr, tzOffsetMinutes: 0, enforceCap: true });
  }
  assert.equal(await countAudit(managerId, 'cap-block'), 0);
  assert.equal(await countAudit(managerId, 'view'), 5);
});

test('enforceCap:false reveals without spending cap — the in-dialer reveal', async () => {
  await resetViews();
  const me = broker(1);
  // Spend the single allowance.
  await revealOwnerPhone(propertyId, { user: me, tzOffsetMinutes: 0, enforceCap: true });
  // The dialer's reveal is already covered by the session's view; it must still work.
  const r = await revealOwnerPhone(propertyId, {
    user: me, tzOffsetMinutes: 0, enforceCap: false,
  });
  assert.equal(r.phone, '+971 50 999 8888');
});

test('the cap is per local day — yesterday\'s views do not count', async () => {
  await resetViews();
  const me = broker(1);
  await revealOwnerPhone(propertyId, { user: me, tzOffsetMinutes: 0, enforceCap: true });

  // Backdate the view by two days: today's allowance should be free again.
  await pool.query(
    `UPDATE audit SET at = DATE_SUB(at, INTERVAL 2 DAY)
     WHERE actor_id = ? AND action = 'view'`, [brokerId],
  );

  const r = await revealOwnerPhone(propertyId, {
    user: me, tzOffsetMinutes: 0, enforceCap: true,
  });
  assert.equal(r.used, 1, 'the day resets');
});

test.after(async () => {
  await pool.query('DELETE FROM properties WHERE id = ?', [propertyId]);
  await pool.query('DELETE FROM users WHERE email LIKE ?', ['%@test.local']);
  await closePool();
});
