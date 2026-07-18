import { pool, closePool } from './pool';
import { env } from '../config/env';
import {
  AppUser, UserRole, demoUsers, demoPassword,
} from '../../../src/types/user';
import {
  Property, OwnerInfo, PropertyState, CallOutcome, VaultSettings, kOrgId,
  DataSet, DataSetType, DataModule,
} from '../../../src/types/models';
import { ImportPipeline } from '../../../src/logic/importPipeline';
import { insertUser, findUserByEmail, countManagers } from '../repositories/userRepo';
import { saveProperties, countTotal } from '../repositories/propertyRepo';
import { insertDataset } from '../repositories/datasetRepo';
import { saveSettings, loadSettings } from '../repositories/settingsRepo';
import { hashPassword, validatePassword } from '../auth/password';
import { newPropertyId } from '../domain/ids';

/**
 * Seed / bootstrap.
 *
 * Two separate jobs, deliberately:
 *
 *  1. BOOTSTRAP — create the first manager, so somebody can sign in and create
 *     everyone else. Idempotent, and safe to run against a live database.
 *
 *  2. DEMO DATA — synthetic owners so the screens aren't all zeros. Gated behind
 *     SEED_DEMO_DATA and refuses to run if the vault already has data.
 *
 * The reference implementation seeded demo data automatically whenever the vault
 * looked empty, which is fine for IndexedDB in one browser and actively
 * dangerous against a shared database. It has to be asked for here.
 *
 * NOTHING here is real data. See src/data/seedDemo.ts — the synthetic names and
 * numbers are the same shape as the originals.
 */

const SYNTHETIC_OWNERS: { name: string; phone?: string; nationality: string }[] = [
  { name: 'Aisha Rahman', phone: '971501110001', nationality: 'UAE' },
  { name: 'Bilal Khan', phone: '971501110002', nationality: 'Pakistan' },
  { name: 'Chen Wei', phone: '971501110003', nationality: 'China' },
  { name: 'Dana Petrova', phone: '971501110004', nationality: 'Russia' },
  { name: 'Elias Haddad', phone: '971501110005', nationality: 'Lebanon' },
  { name: 'Farah Siddiqui', phone: '971501110006', nationality: 'India' },
  { name: 'George Whitfield', phone: '971501110007', nationality: 'UK' },
  { name: 'Hana Yamamoto', nationality: 'Japan' },
  { name: 'Ibrahim Nasser', phone: '971501110009', nationality: 'Egypt' },
  { name: 'Julia Moreau', phone: '971501110010', nationality: 'France' },
];

const COMMUNITIES = [
  { name: 'Dubai Hills Estate', clusters: ['Sidra', 'Maple', 'Golf Place'] },
  { name: 'Palm Jumeirah', clusters: ['Shoreline', 'Signature Villas'] },
  { name: 'Arabian Ranches', clusters: ['Al Reem', 'Palmera'] },
];

const TYPES = ['Villa', 'Townhouse', 'Apartment'];

/**
 * The demo data belongs to a real data set, so it can be deleted from the
 * "Data sets" screen like any import. The reference seed left dataset_id NULL,
 * which meant the synthetic rows showed up everywhere but had no set to remove
 * them by — the manager could see 98 units and no way to clear them.
 */
const DEMO_DATASET_ID = 'ds-demo-synthetic';

function buildDemoProperties(): Property[] {
  const now = new Date().toISOString();
  const out: Property[] = [];
  let n = 0;

  for (const community of COMMUNITIES) {
    for (const cluster of community.clusters) {
      for (let i = 1; i <= 14; i++) {
        const owner = SYNTHETIC_OWNERS[n % SYNTHETIC_OWNERS.length];
        const unitNumber = `${i + 100}`;
        const building = cluster === 'Shoreline' ? `Building ${(i % 4) + 1}` : undefined;
        const unitKey = ImportPipeline.unitKeyFor({
          community: community.name, cluster, building, unitNumber,
        })!;

        // Deterministic spread across states so every screen has something.
        const state =
          n % 7 === 0 ? PropertyState.assigned :
          n % 11 === 0 ? PropertyState.portfolio :
          n % 13 === 0 ? PropertyState.cooling :
          PropertyState.pool;

        const daysAgo = (n * 37) % 900;
        const txDate = new Date(Date.now() - daysAgo * 24 * 3600_000).toISOString();

        const p = new Property(
          newPropertyId(), kOrgId, DEMO_DATASET_ID, state, unitKey, community.name,
          cluster, building, unitNumber, undefined,
          TYPES[n % TYPES.length],
          (n % 4) + 1,
          900 + ((n * 137) % 3500),
          undefined,
          txDate,
          1_200_000 + ((n * 91_000) % 9_000_000),
          1,
          undefined, undefined, undefined,
          new OwnerInfo(owner.name, owner.phone, owner.nationality),
          now, now,
        );
        if (state === PropertyState.cooling) {
          p.lastOutcome = CallOutcome.notInterested;
          p.cooldownUntil = new Date(Date.now() + 12 * 24 * 3600_000).toISOString();
          p.lastCalledAt = new Date(Date.now() - 18 * 24 * 3600_000).toISOString();
        }
        out.push(p);
        n++;
      }
    }
  }
  return out;
}

async function bootstrapManager(log: (m: string) => void): Promise<void> {
  if ((await countManagers()) > 0) {
    log('  a manager account already exists — skipping bootstrap');
    return;
  }

  const password = env.bootstrap.password;
  if (!password) {
    throw new Error(
      'No manager exists and BOOTSTRAP_MANAGER_PASSWORD is not set.\n' +
      'Set it in server/.env, then run `npm run seed` again.',
    );
  }
  const problem = validatePassword(password);
  if (problem) {
    throw new Error(`BOOTSTRAP_MANAGER_PASSWORD is not acceptable: ${problem.message}`);
  }

  const existing = await findUserByEmail(env.bootstrap.email);
  if (existing) {
    log(`  ${env.bootstrap.email} already exists — skipping bootstrap`);
    return;
  }

  const user = new AppUser(
    'u-director', env.bootstrap.name, env.bootstrap.email.toLowerCase(),
    UserRole.manager, true, 'Leadership', undefined, undefined,
    new Date().toISOString(),
  );
  await insertUser({
    user,
    passwordHash: await hashPassword(password),
    // Forced change on first sign-in: the bootstrap password has been sitting
    // in a .env file and should not survive first contact.
    mustChangePassword: true,
  });
  log(`  created manager ${user.email} (must change password on first sign-in)`);
}

async function seedDemoUsers(log: (m: string) => void): Promise<void> {
  // The two demo brokers, so assignment has somewhere to go.
  for (const demo of demoUsers.filter(u => u.role === UserRole.broker)) {
    if (await findUserByEmail(demo.email)) continue;
    await insertUser({
      user: demo,
      passwordHash: await hashPassword(demoPassword),
      mustChangePassword: true,
    });
    log(`  created demo broker ${demo.email}`);
  }
}

async function seedDemoData(log: (m: string) => void): Promise<void> {
  const existing = await countTotal();
  if (existing > 0) {
    log(`  vault already holds ${existing} units — refusing to seed over it`);
    return;
  }

  const properties = buildDemoProperties();

  // The dataset row must exist before the properties that point at it — there's
  // a FK from properties.dataset_id → datasets.id. With it in place the whole
  // demo set is deletable from Control → Import & Files → Data sets.
  const demoDataset = new DataSet(
    DEMO_DATASET_ID,
    'Demo data (synthetic)',
    'Seed',
    DataSetType.register,
    DataModule.owners,
    'seed',
    'Demo communities',
    new Date().toISOString(),
    undefined,
    properties.length,
    properties.filter(p => p.callable).length,
    0,
  );
  await insertDataset(demoDataset, null);
  await saveProperties(properties);
  log(`  seeded ${properties.length} SYNTHETIC properties (data set "${demoDataset.name}")`);

  const brokers = demoUsers.filter(u => u.role === UserRole.broker);
  if (brokers.length > 0) {
    // Hand the assigned/portfolio units to the demo brokers so the dialer and
    // the broker home have something to show.
    const [rows] = await pool.query<import('mysql2/promise').RowDataPacket[]>(
      `SELECT id FROM properties WHERE org_id = ? AND state IN ('assigned','portfolio')`,
      [kOrgId],
    );
    let i = 0;
    for (const r of rows) {
      const broker = brokers[i % brokers.length];
      await pool.query(
        'UPDATE properties SET assigned_to = ?, assigned_at = ? WHERE id = ?',
        [broker.id, new Date(), r.id],
      );
      i++;
    }
    log(`  assigned ${rows.length} units across ${brokers.length} demo brokers`);
  }
}

export async function seed(log: (m: string) => void = console.log): Promise<void> {
  log('Bootstrap:');
  await bootstrapManager(log);

  const current = await loadSettings();
  await saveSettings(current);

  if (env.seedDemoData) {
    log('Demo data (synthetic):');
    await seedDemoUsers(log);
    await seedDemoData(log);
  } else {
    log('SEED_DEMO_DATA is off — no demo data written.');
  }
  log('Done.');
}

if (require.main === module) {
  seed()
    .then(async () => { await closePool(); process.exit(0); })
    .catch(async (err) => {
      console.error('\nSeed failed:\n', err instanceof Error ? err.message : err);
      await closePool().catch(() => {});
      process.exit(1);
    });
}
