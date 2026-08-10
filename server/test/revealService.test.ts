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

/**
 * The reveal is the only door a real phone number leaves by. There is no daily
 * cap anymore — the audit trail is the control, so every reveal must be recorded.
 */

let brokerId: string;
let propertyId: string;

async function countAudit(actorId: string, action: string): Promise<number> {
  const [rows] = await pool.query<any[]>(
    'SELECT COUNT(*) AS n FROM audit WHERE actor_id = ? AND action = ?', [actorId, action],
  );
  return Number(rows[0].n);
}

function broker(): AppUser {
  return new AppUser(brokerId, 'Reveal Broker', `reveal-${brokerId}@test.local`,
    UserRole.broker, true, '', undefined, new Date().toISOString());
}

test.before(async () => {
  brokerId = newUserId();
  await insertUser({
    user: broker(),
    passwordHash: 'scrypt$131072$8$1$AAAA$AAAA', mustChangePassword: false,
  });

  const now = new Date().toISOString();
  const unitKey = ImportPipeline.unitKeyFor({
    community: 'Reveal Community', building: 'T9', unitNumber: '901',
  })!;
  const p = new Property(
    newPropertyId(), kOrgId, '', PropertyState.assigned, unitKey, 'Reveal Community',
    undefined, 'T9', '901', undefined, 'Villa', 3, 2000, undefined,
    undefined, undefined, 0, undefined, undefined, undefined,
    new OwnerInfo('Reveal Target', '971509998888', 'UAE'), now, now,
  );
  p.assignedTo = brokerId;
  await saveProperties([p]);
  propertyId = p.id;
});

async function resetViews() {
  await pool.query(`DELETE FROM audit WHERE actor_id = ? AND action = 'view'`, [brokerId]);
}

test('reveal returns the grouped number and audits it', async () => {
  await resetViews();
  const r = await revealOwnerPhone(propertyId, { user: broker() });

  assert.equal(r.phone, '+971 50 999 8888', 'grouped exactly as prettyPhone rendered before');
  assert.equal(await countAudit(brokerId, 'view'), 1, 'the reveal is audited');
});

test('every reveal is allowed and audited — there is no daily cap', async () => {
  await resetViews();
  const me = broker();
  for (let i = 0; i < 5; i++) {
    const r = await revealOwnerPhone(propertyId, { user: me });
    assert.equal(r.phone, '+971 50 999 8888');
  }
  assert.equal(await countAudit(brokerId, 'view'), 5, 'each reveal writes one audit, none blocked');
});

test.after(async () => {
  await pool.query('DELETE FROM properties WHERE id = ?', [propertyId]);
  await pool.query('DELETE FROM users WHERE email LIKE ?', ['%@test.local']);
  await closePool();
});
