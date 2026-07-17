import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { AppUser, Permission } from '../../../src/types/user';
import { readSession, SESSION_COOKIE, CSRF_HEADER } from '../auth/sessions';
import { findUserById } from '../repositories/userRepo';
import { unauthorized, forbidden } from '../http/errors';

declare module 'fastify' {
  interface FastifyRequest {
    /** The authenticated user, or null. Populated by the onRequest hook. */
    currentUser: AppUser | null;
    sessionToken: string | null;
    sessionCsrf: string | null;
  }
  interface FastifyInstance {
    /** Require a signed-in, active user. */
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Require a signed-in user holding `permission`. */
    requirePermission: (
      permission: Permission,
    ) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Require a manager. */
    requireManager: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/**
 * Authentication + authorization.
 *
 * This is the file that turns the reference implementation's *cosmetic* access
 * control into real access control. `AppUser.can()` and `isManager` used to only
 * hide buttons; the same checks now run here, server-side, where a client cannot
 * skip them. Routes opt in via `preHandler` — nothing is protected by default,
 * so a new route with no preHandler is public by omission. Grep for
 * `requirePermission` when adding one.
 */
async function authPlugin(app: FastifyInstance) {
  app.decorateRequest('currentUser', null);
  app.decorateRequest('sessionToken', null);
  app.decorateRequest('sessionCsrf', null);

  /**
   * Resolve the session cookie into a user, then enforce CSRF. One hook, so the
   * session is read from the database exactly once per request.
   */
  app.addHook('onRequest', async (req) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) {
      const session = await readSession(token);
      if (session) {
        const user = await findUserById(session.userId);
        // A deactivated user's session is dead on arrival even if the cookie is
        // still valid — the check the client-side version could never make.
        if (user && user.active) {
          req.currentUser = user;
          req.sessionToken = token;
          req.sessionCsrf = session.csrfToken;
        }
      }
    }

    // CSRF: double-submit. The session cookie is sameSite=strict, which already
    // blocks the classic cross-site form post; this is defence in depth for the
    // flows where that doesn't hold. Safe methods are exempt. Unauthenticated
    // writes need no check — they're rejected by `authenticate` anyway, and
    // login itself must work before any CSRF token exists.
    const method = req.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
    if (!req.currentUser) return;

    const sent = req.headers[CSRF_HEADER];
    if (typeof sent !== 'string' || sent.length === 0 || sent !== req.sessionCsrf) {
      throw forbidden('Request rejected (CSRF check failed). Refresh the page and try again.');
    }
  });

  app.decorate('authenticate', async (req: FastifyRequest, _reply: FastifyReply) => {
    if (!req.currentUser) throw unauthorized();
  });

  app.decorate('requireManager', async (req: FastifyRequest, _reply: FastifyReply) => {
    if (!req.currentUser) throw unauthorized();
    if (!req.currentUser.isManager) throw forbidden('Managers only.');
  });

  app.decorate(
    'requirePermission',
    (permission: Permission) => async (req: FastifyRequest, _reply: FastifyReply) => {
      if (!req.currentUser) throw unauthorized();
      // AppUser.can() already folds in `active` — the same shared class the UI uses.
      if (!req.currentUser.can(permission)) {
        throw forbidden('You do not have permission to do that.');
      }
    },
  );
}

export default fp(authPlugin, { name: 'auth' });
