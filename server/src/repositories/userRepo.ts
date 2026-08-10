import type { PoolConnection } from 'mysql2/promise';
import { pool, Row, toDb, fromDb } from '../db/pool';
import { AppUser, UserRole, Permission } from '../../../src/types/user';
import { kOrgId } from '../../../src/types/models';

/**
 * Users.
 *
 * Rows map onto the shared `AppUser` class so routes, permission checks and the
 * UI all speak the same type. Note `permissions`: NULL in the database means
 * "use the role defaults", which is exactly what `AppUser`'s optional set means
 * — round-tripping NULL rather than materialising the defaults keeps a user's
 * permissions following their role if the role's defaults ever change.
 */

export interface UserAuthRow {
  user: AppUser;
  passwordHash: string;
  mustChangePassword: boolean;
}

function toUser(r: Row): AppUser {
  const rawPerms = r.permissions as unknown;
  let perms: Set<Permission> | undefined;

  if (rawPerms != null) {
    // mysql2 gives back parsed JSON for JSON columns; be tolerant of a string.
    const arr: unknown = typeof rawPerms === 'string' ? JSON.parse(rawPerms) : rawPerms;
    if (Array.isArray(arr)) {
      const valid = new Set(Object.values(Permission) as string[]);
      perms = new Set(arr.filter((p): p is Permission => typeof p === 'string' && valid.has(p)));
    }
  }

  return new AppUser(
    r.id as string,
    r.name as string,
    r.email as string,
    (r.role as string) === 'manager' ? UserRole.manager : UserRole.broker,
    !!r.active,
    (r.team as string) ?? '',
    perms,
    fromDb(r.created_at),
    !!r.ip_locked,
  );
}

const SELECT = `
  SELECT id, org_id, name, email, role, active, team, permissions,
         created_at, ip_locked
  FROM users`;

export async function findUserById(id: string): Promise<AppUser | null> {
  const [rows] = await pool.query<Row[]>(`${SELECT} WHERE id = ? LIMIT 1`, [id]);
  return rows.length ? toUser(rows[0]) : null;
}

export async function findUserByEmail(email: string): Promise<AppUser | null> {
  const [rows] = await pool.query<Row[]>(`${SELECT} WHERE email = ? LIMIT 1`, [
    email.trim().toLowerCase(),
  ]);
  return rows.length ? toUser(rows[0]) : null;
}

/** Login path — pulls the hash alongside the user so we hash-compare once. */
export async function findAuthByEmail(email: string): Promise<UserAuthRow | null> {
  const [rows] = await pool.query<Row[]>(
    `SELECT id, org_id, name, email, role, active, team, permissions,
            created_at, ip_locked, password_hash, must_change_password
     FROM users WHERE email = ? LIMIT 1`,
    [email.trim().toLowerCase()],
  );
  if (rows.length === 0) return null;
  return {
    user: toUser(rows[0]),
    passwordHash: rows[0].password_hash as string,
    mustChangePassword: !!rows[0].must_change_password,
  };
}

export async function findAuthById(id: string): Promise<UserAuthRow | null> {
  const [rows] = await pool.query<Row[]>(
    `SELECT id, org_id, name, email, role, active, team, permissions,
            created_at, ip_locked, password_hash, must_change_password
     FROM users WHERE id = ? LIMIT 1`,
    [id],
  );
  if (rows.length === 0) return null;
  return {
    user: toUser(rows[0]),
    passwordHash: rows[0].password_hash as string,
    mustChangePassword: !!rows[0].must_change_password,
  };
}

export async function listUsers(): Promise<AppUser[]> {
  // Sorted the same way the reference VaultSnapshot sorted them, so the Users
  // table renders in an unchanged order.
  const [rows] = await pool.query<Row[]>(`${SELECT} WHERE org_id = ? ORDER BY LOWER(name) ASC`, [
    kOrgId,
  ]);
  return rows.map(toUser);
}

export async function listBrokers(): Promise<AppUser[]> {
  const [rows] = await pool.query<Row[]>(
    `${SELECT} WHERE org_id = ? AND role = 'broker' ORDER BY LOWER(name) ASC`,
    [kOrgId],
  );
  return rows.map(toUser);
}

export async function emailTaken(email: string, exceptId?: string): Promise<boolean> {
  const [rows] = await pool.query<Row[]>(
    'SELECT id FROM users WHERE email = ? AND (? IS NULL OR id <> ?) LIMIT 1',
    [email.trim().toLowerCase(), exceptId ?? null, exceptId ?? ''],
  );
  return rows.length > 0;
}

export interface InsertUserInput {
  user: AppUser;
  passwordHash: string;
  mustChangePassword: boolean;
}

export async function insertUser(input: InsertUserInput, cx?: PoolConnection): Promise<void> {
  const db = cx ?? pool;
  const u = input.user;
  const now = new Date();
  await db.query(
    `INSERT INTO users
       (id, org_id, name, email, password_hash, must_change_password, role, active,
        team, permissions, ip_locked, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      u.id, kOrgId, u.name, u.email.trim().toLowerCase(),
      input.passwordHash, input.mustChangePassword ? 1 : 0,
      u.role, u.active ? 1 : 0, u.team,
      serializePermissions(u),
      u.ipLocked ? 1 : 0,
      toDb(u.createdAt) ?? now,
      now,
    ],
  );
}

/** Updates profile fields only — never the password (see setPassword). */
export async function updateUser(u: AppUser, cx?: PoolConnection): Promise<void> {
  const db = cx ?? pool;
  await db.query(
    `UPDATE users SET name = ?, email = ?, role = ?, active = ?, team = ?,
            permissions = ?, ip_locked = ?, updated_at = ?
     WHERE id = ?`,
    [
      u.name, u.email.trim().toLowerCase(), u.role, u.active ? 1 : 0, u.team,
      serializePermissions(u),
      u.ipLocked ? 1 : 0,
      new Date(),
      u.id,
    ],
  );
}

export async function setPassword(
  userId: string,
  passwordHash: string,
  mustChange: boolean,
  cx?: PoolConnection,
): Promise<void> {
  const db = cx ?? pool;
  await db.query(
    'UPDATE users SET password_hash = ?, must_change_password = ?, updated_at = ? WHERE id = ?',
    [passwordHash, mustChange ? 1 : 0, new Date(), userId],
  );
}

export async function countManagers(): Promise<number> {
  const [rows] = await pool.query<Row[]>(
    `SELECT COUNT(*) AS n FROM users WHERE org_id = ? AND role = 'manager' AND active = 1`,
    [kOrgId],
  );
  return Number(rows[0].n);
}

/**
 * Mirrors AppUser.toJson() deliberately: it writes the *effective* set
 * (`Array.from(this.permissions)`), materialising role defaults rather than
 * storing "follows defaults".
 *
 * Storing NULL-means-defaults would be tidier and would let defaults propagate,
 * but it would silently change who can do what — e.g. a broker promoted to
 * manager would gain the manager defaults, where today they keep the permission
 * set frozen at their last save. That's a security-relevant behaviour change, so
 * it is preserved exactly. (The column stays nullable: NULL, only ever written
 * by the seed, reads back as role defaults.)
 */
function serializePermissions(u: AppUser): string | null {
  return JSON.stringify(Array.from(u.permissions));
}
