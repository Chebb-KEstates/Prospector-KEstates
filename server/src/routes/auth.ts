import { FastifyInstance } from 'fastify';
import { prisma } from '../db';
import { config } from '../config';
import { verifyPassword } from '../auth/password';
import { userToJson } from '../domain/mappers';

// Error copy mirrors the original client-side AuthContext exactly.
const NOT_RECOGNISED = 'Email or password not recognised. Accounts are created by your manager.';
const DISABLED = 'This account has been disabled. Contact your manager.';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/auth/login', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', maxLength: 320 },
          password: { type: 'string', maxLength: 200 },
        },
      },
    },
  }, async (req, reply) => {
    const { email, password } = req.body as { email: string; password: string };
    const user = await prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    if (!user) return reply.code(401).send({ error: NOT_RECOGNISED });
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) return reply.code(401).send({ error: NOT_RECOGNISED });
    if (!user.active) return reply.code(403).send({ error: DISABLED });

    const token = await reply.jwtSign({ sub: user.id }, { expiresIn: config.jwtExpiresIn });
    reply.setCookie(config.cookieName, token, {
      httpOnly: true,
      secure: config.cookieSecure,
      sameSite: config.cookieSameSite,
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    });
    return reply.send({ user: userToJson(user) });
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.clearCookie(config.cookieName, { path: '/' });
    return reply.send({ ok: true });
  });

  app.get('/api/auth/me', { preHandler: [app.authenticate] }, async (req, reply) => {
    const u = await prisma.user.findUnique({ where: { id: req.currentUser!.id } });
    if (!u || !u.active) return reply.code(401).send({ error: 'Account not found or disabled' });
    return reply.send({ user: userToJson(u) });
  });
}
