import type { FastifyInstance } from 'fastify';
import {
  findAuthByEmail, findAuthById, setPassword,
} from '../repositories/userRepo';
import { hashPassword, verifyPassword, validatePassword, needsRehash } from '../auth/password';
import {
  createSession, revokeSession, revokeAllFor,
  SESSION_COOKIE, CSRF_COOKIE, sessionCookieOptions, csrfCookieOptions,
} from '../auth/sessions';
import { writeAudit } from '../repositories/auditRepo';
import { unauthorized, badRequest, forbidden } from '../http/errors';
import { publicUser } from '../http/serializers';

/**
 * Authentication.
 *
 * Replaces a client-side string comparison against a password baked into the
 * JS bundle (`demoPassword = 'demo1234'`, which *every* account matched) and a
 * sessionStorage user-id the client asserted on reload.
 *
 * The user-facing error strings are carried over verbatim from AuthContext so
 * the login screen reads exactly as it did.
 */
export default async function authRoutes(app: FastifyInstance) {
  /**
   * Login is the one place we deliberately do NOT distinguish "no such account"
   * from "wrong password" — the reference message already merged them, and
   * merging them is also what stops the endpoint being an account oracle.
   */
  app.post('/api/auth/login', {
    config: {
      // Tighter than the global limit: this is the credential-stuffing surface.
      rateLimit: { max: 10, timeWindow: '5 minutes' },
    },
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password'],
        additionalProperties: false,
        properties: {
          email: { type: 'string', minLength: 3, maxLength: 255 },
          password: { type: 'string', minLength: 1, maxLength: 200 },
        },
      },
    },
  }, async (req, reply) => {
    const { email, password } = req.body as { email: string; password: string };

    const found = await findAuthByEmail(email);

    // Always spend the cost of a hash comparison, even when the account does
    // not exist, so response time doesn't reveal which emails are registered.
    const hashToCheck = found?.passwordHash
      ?? '$scrypt$131072$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const ok = await verifyPassword(password, hashToCheck);

    if (!found || !ok) {
      throw unauthorized('Email or password not recognised. Accounts are created by your manager.');
    }
    if (!found.user.active) {
      throw forbidden('This account has been disabled. Contact your manager.');
    }

    // Opportunistically upgrade a hash made with weaker parameters.
    if (needsRehash(found.passwordHash)) {
      await setPassword(found.user.id, await hashPassword(password), found.mustChangePassword);
    }

    const session = await createSession(found.user.id, {
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });

    reply
      .setCookie(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt))
      .setCookie(CSRF_COOKIE, session.csrfToken, csrfCookieOptions(session.expiresAt));

    await writeAudit({
      actorId: found.user.id,
      action: 'signin',
      detail: `Signed in — ${found.user.email}`,
    });

    return {
      user: publicUser(found.user),
      mustChangePassword: found.mustChangePassword,
      csrfToken: session.csrfToken,
    };
  });

  /** Who am I? The frontend calls this on boot to restore a session. */
  app.get('/api/auth/session', async (req) => {
    if (!req.currentUser) return { user: null, mustChangePassword: false, csrfToken: null };
    const auth = await findAuthById(req.currentUser.id);
    return {
      user: publicUser(req.currentUser),
      mustChangePassword: auth?.mustChangePassword ?? false,
      csrfToken: req.sessionCsrf,
    };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    if (req.sessionToken) await revokeSession(req.sessionToken);
    reply
      .clearCookie(SESSION_COOKIE, { path: '/' })
      .clearCookie(CSRF_COOKIE, { path: '/' });
    return { ok: true };
  });

  /**
   * Change own password. Required on first sign-in for an account whose password
   * was set by a manager; available any time otherwise.
   *
   * Every other session for this user is revoked — changing a password because
   * you think it's compromised should actually evict whoever else is using it.
   */
  app.post('/api/auth/change-password', {
    preHandler: [app.authenticate],
    config: { rateLimit: { max: 10, timeWindow: '5 minutes' } },
    schema: {
      body: {
        type: 'object',
        required: ['currentPassword', 'newPassword'],
        additionalProperties: false,
        properties: {
          currentPassword: { type: 'string', minLength: 1, maxLength: 200 },
          newPassword: { type: 'string', minLength: 1, maxLength: 200 },
        },
      },
    },
  }, async (req, reply) => {
    const { currentPassword, newPassword } = req.body as {
      currentPassword: string; newPassword: string;
    };
    const me = req.currentUser!;

    const auth = await findAuthById(me.id);
    if (!auth) throw unauthorized();

    if (!(await verifyPassword(currentPassword, auth.passwordHash))) {
      throw badRequest('Your current password is not correct.');
    }
    const problem = validatePassword(newPassword);
    if (problem) throw badRequest(problem.message);
    if (await verifyPassword(newPassword, auth.passwordHash)) {
      throw badRequest('Your new password must be different from your current one.');
    }

    await setPassword(me.id, await hashPassword(newPassword), false);
    await revokeAllFor(me.id);

    // Re-issue a session so the caller stays signed in on this device.
    const session = await createSession(me.id, {
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
    reply
      .setCookie(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt))
      .setCookie(CSRF_COOKIE, session.csrfToken, csrfCookieOptions(session.expiresAt));

    await writeAudit({
      actorId: me.id,
      action: 'password',
      detail: 'Password changed',
    });

    return { ok: true, csrfToken: session.csrfToken };
  });
}
