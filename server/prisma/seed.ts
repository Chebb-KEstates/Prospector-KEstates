/**
 * Seeds the three demo accounts (matching the original frontend `demoUsers`),
 * the default settings row, and the revision counter. Idempotent — safe to run
 * repeatedly. Demo accounts get the password `demo1234` (or SEED_DEMO_PASSWORD)
 * so the existing quick-sign-in buttons keep working after migration.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const orgId = process.env.ORG_ID ?? 'org-1';
const demoPassword = process.env.SEED_DEMO_PASSWORD ?? 'demo1234';
const rounds = parseInt(process.env.BCRYPT_ROUNDS ?? '12', 10);

const demoUsers = [
  { id: 'u-director', name: 'The Director', email: 'director@demo.ae', role: 'manager', team: 'Leadership' },
  { id: 'u-sara', name: 'Sara Malik', email: 'sara@demo.ae', role: 'broker', team: 'Secondary Market' },
  { id: 'u-omar', name: 'Omar Farouk', email: 'omar@demo.ae', role: 'broker', team: 'Secondary Market' },
];

async function main() {
  const passwordHash = await bcrypt.hash(demoPassword, rounds);

  for (const u of demoUsers) {
    await prisma.user.upsert({
      where: { id: u.id },
      create: {
        id: u.id, name: u.name, email: u.email, role: u.role,
        active: true, team: u.team, permissions: undefined,
        viewCapOverride: null, createdAt: '2026-01-01T00:00:00.000Z',
        passwordHash,
      },
      // Do not clobber a password an admin may have changed; only ensure the
      // account exists with its baseline profile.
      update: { name: u.name, email: u.email, role: u.role, team: u.team },
    });
  }

  await prisma.settings.upsert({
    where: { id: orgId },
    create: { id: orgId },
    update: {},
  });

  await prisma.meta.upsert({
    where: { id: 'rev' },
    create: { id: 'rev', rev: BigInt(0) },
    update: {},
  });

  // eslint-disable-next-line no-console
  console.log(`Seed complete — ${demoUsers.length} demo users, settings, meta.`);
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
