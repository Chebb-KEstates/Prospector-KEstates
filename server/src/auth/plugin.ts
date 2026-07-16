import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import fastifyCookie from '@fastify/cookie';
import { config } from '../config';
import { prisma } from '../db';
import { defaultPermissions, PermissionValue } from '../domain/constants';

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  permissions: Set<string>;
}

declare module 'fastify' {
  interface FastifyRequest {
    currentUser?: CurrentUser;
  }
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requirePermission: (
      perm: PermissionValue,
    ) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string };
    user: { sub: string };
  }
}

function effectivePermissions(role: string, permissions: unknown): Set<string> {
  const arr = Array.isArray(permissions) && permissions.length > 0
    ? (permissions as string[])
    : defaultPermissions(role);
  return new Set(arr);
}

export async function registerAuth(app: FastifyInstance): Promise<void> {
  await app.register(fastifyCookie);
  await app.register(fastifyJwt, {
    secret: config.jwtSecret,
    cookie: { cookieName: config.cookieName, signed: false },
  });

  // Verifies the auth cookie, loads a fresh copy of the user, and rejects
  // disabled/deleted accounts. Populates `request.currentUser`.
  app.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
    let sub: string;
    try {
      const decoded = await req.jwtVerify<{ sub: string }>();
      sub = decoded.sub;
    } catch {
      return reply.code(401).send({ error: 'Not authenticated' });
    }
    const u = await prisma.user.findUnique({ where: { id: sub } });
    if (!u || !u.active) {
      return reply.code(401).send({ error: 'Account not found or disabled' });
    }
    req.currentUser = {
      id: u.id, name: u.name, email: u.email, role: u.role, active: u.active,
      permissions: effectivePermissions(u.role, u.permissions),
    };
  });

  app.decorate('requirePermission', (perm: PermissionValue) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.currentUser;
      if (!user) return reply.code(401).send({ error: 'Not authenticated' });
      if (!user.active || !user.permissions.has(perm)) {
        return reply.code(403).send({ error: 'Insufficient permissions' });
      }
    });
}
