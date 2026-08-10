import type { FastifyInstance } from 'fastify';
import { AppUser, UserRole, Permission } from '../../../src/types/user';
import {
  listUsers, findUserById, insertUser, updateUser, setPassword,
  emailTaken, countManagers,
} from '../repositories/userRepo';
import { hashPassword, validatePassword } from '../auth/password';
import { revokeAllFor } from '../auth/sessions';
import { writeAudit } from '../repositories/auditRepo';
import { publicUser } from '../http/serializers';
import { newUserId } from '../domain/ids';
import { badRequest, notFound, conflict, forbidden } from '../http/errors';

/**
 * User administration.
 *
 * Users are DEACTIVATED, never deleted — history must stay auditable, and a
 * past employee's calls must still be attributable. There is deliberately no
 * DELETE route, even though the old repository interface had `deleteUser`.
 *
 * Passwords: a manager sets the colleague's first password and the account is
 * forced to change it on first sign-in. That replaces the reference behaviour,
 * where every account — including ones a manager created — signed in with the
 * `demo1234` string compiled into the JS bundle.
 */
export default async function userRoutes(app: FastifyInstance) {
  app.get('/api/users', {
    preHandler: [app.authenticate],
  }, async (req) => {
    const me = req.currentUser!;
    const users = await listUsers();
    // Brokers need names to render "assigned by" / "called by" attributions,
    // but nothing else about their colleagues.
    if (!me.isManager) {
      return users.map(u => ({ id: u.id, name: u.name, role: u.role, active: u.active }));
    }
    return users.map(publicUser);
  });

  app.post('/api/users', {
    preHandler: [app.authenticate, app.requirePermission(Permission.manageUsers)],
    schema: {
      body: {
        type: 'object',
        required: ['name', 'email', 'role', 'initialPassword'],
        additionalProperties: false,
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 255 },
          email: { type: 'string', minLength: 3, maxLength: 255 },
          role: { type: 'string', enum: Object.values(UserRole) },
          team: { type: 'string', maxLength: 255 },
          active: { type: 'boolean' },
          permissions: {
            type: 'array', items: { type: 'string', enum: Object.values(Permission) },
          },
          ipLocked: { type: 'boolean' },
          initialPassword: { type: 'string', minLength: 1, maxLength: 200 },
        },
      },
    },
  }, async (req) => {
    const body = req.body as {
      name: string; email: string; role: UserRole; team?: string;
      active?: boolean; permissions?: Permission[];
      ipLocked?: boolean; initialPassword: string;
    };

    const email = body.email.trim().toLowerCase();
    if (!email.includes('@')) throw badRequest('That email address is not valid.');
    if (await emailTaken(email)) {
      throw conflict('An account with that email already exists.');
    }

    const problem = validatePassword(body.initialPassword);
    if (problem) throw badRequest(problem.message);

    const user = new AppUser(
      newUserId(), body.name.trim(), email, body.role,
      body.active ?? true, (body.team ?? '').trim(),
      // Matches the Users modal: no boxes ticked means "role defaults".
      body.permissions && body.permissions.length > 0 ? new Set(body.permissions) : undefined,
      new Date().toISOString(),
      body.ipLocked ?? false,
    );

    await insertUser({
      user,
      passwordHash: await hashPassword(body.initialPassword),
      mustChangePassword: true,
    });

    await writeAudit({
      actorId: req.currentUser!.id,
      action: 'user',
      detail: `Created — ${user.name} (${user.role})`,
    });

    return publicUser(user);
  });

  app.patch('/api/users/:id', {
    preHandler: [app.authenticate, app.requirePermission(Permission.manageUsers)],
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', maxLength: 64 } } },
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 255 },
          email: { type: 'string', minLength: 3, maxLength: 255 },
          role: { type: 'string', enum: Object.values(UserRole) },
          team: { type: 'string', maxLength: 255 },
          active: { type: 'boolean' },
          permissions: {
            type: 'array', items: { type: 'string', enum: Object.values(Permission) },
          },
          ipLocked: { type: 'boolean' },
        },
      },
    },
  }, async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as {
      name?: string; email?: string; role?: UserRole; team?: string;
      active?: boolean; permissions?: Permission[];
      ipLocked?: boolean;
    };
    const me = req.currentUser!;

    const target = await findUserById(id);
    if (!target) throw notFound('That account no longer exists.');

    if (body.email) {
      const email = body.email.trim().toLowerCase();
      if (!email.includes('@')) throw badRequest('That email address is not valid.');
      if (await emailTaken(email, id)) {
        throw conflict('An account with that email already exists.');
      }
    }

    // Guard rails the client version had only as UI affordances.
    if (id === me.id && body.active === false) {
      throw badRequest('You cannot deactivate your own account.');
    }
    if (id === me.id && body.role === UserRole.broker) {
      throw badRequest('You cannot demote your own account.');
    }
    // Don't allow the last active manager to be removed — that locks everyone
    // out of user administration permanently.
    const losingManager =
      target.isManager && (body.active === false || body.role === UserRole.broker);
    if (losingManager && (await countManagers()) <= 1) {
      throw badRequest('This is the last active manager. Promote someone else first.');
    }

    const updated = target.copyWith({
      name: body.name?.trim(),
      email: body.email?.trim().toLowerCase(),
      role: body.role,
      team: body.team?.trim(),
      active: body.active,
      permissions: body.permissions
        ? (body.permissions.length > 0 ? new Set(body.permissions) : null)
        : undefined,
      ipLocked: body.ipLocked,
    });

    await updateUser(updated);

    // Deactivation must actually evict them — the client could never do this.
    // (AuthContext.refreshFrom was written for it and never called.)
    if (body.active === false) await revokeAllFor(id);

    const action = body.active === false ? 'Deactivated'
      : body.active === true && !target.active ? 'Reactivated'
      : 'Edited';
    await writeAudit({
      actorId: me.id,
      action: 'user',
      detail: `${action} — ${updated.name} (${updated.role})`,
    });

    return publicUser(updated);
  });

  /** A manager resetting a colleague's password; forces a change on next sign-in. */
  app.post('/api/users/:id/password', {
    preHandler: [app.authenticate, app.requirePermission(Permission.manageUsers)],
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', maxLength: 64 } } },
      body: {
        type: 'object', required: ['newPassword'], additionalProperties: false,
        properties: { newPassword: { type: 'string', minLength: 1, maxLength: 200 } },
      },
    },
  }, async (req) => {
    const { id } = req.params as { id: string };
    const { newPassword } = req.body as { newPassword: string };
    const me = req.currentUser!;

    const target = await findUserById(id);
    if (!target) throw notFound('That account no longer exists.');

    // Changing your OWN password requires knowing the current one — otherwise a
    // borrowed unlocked laptop is a permanent account takeover.
    if (id === me.id) {
      throw forbidden('Use "change password" to set your own password.');
    }

    const problem = validatePassword(newPassword);
    if (problem) throw badRequest(problem.message);

    await setPassword(id, await hashPassword(newPassword), true);
    await revokeAllFor(id);

    await writeAudit({
      actorId: me.id, action: 'password',
      detail: `Password reset for ${target.name}`,
    });

    return { ok: true };
  });
}
