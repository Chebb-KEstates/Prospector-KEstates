import { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { config } from '../config';
import { hashPassword } from '../auth/password';
import { userWriteData, userToJson, UserPayload } from '../domain/mappers';
import { bumpRev } from '../store';

const userBody = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string', maxLength: 64 },
    name: { type: 'string', maxLength: 255 },
    email: { type: 'string', maxLength: 320 },
    role: { type: 'string', enum: ['manager', 'broker'] },
    active: { type: 'boolean' },
    team: { type: 'string', maxLength: 255 },
    permissions: { type: ['array', 'null'], items: { type: 'string' } },
    viewCapOverride: { type: ['number', 'null'] },
    createdAt: { type: 'string' },
    password: { type: 'string', minLength: 4, maxLength: 200 },
  },
} as const;

// Normalise email the same way the client matches it (trim + lowercase),
// so lookups and the unique constraint stay consistent.
function normEmail(v?: string): string {
  return (v ?? '').trim().toLowerCase();
}

export async function userRoutes(app: FastifyInstance): Promise<void> {
  const guard = [app.authenticate, app.requirePermission('manageUsers')];

  app.post('/api/users', { preHandler: guard, schema: { body: userBody } }, async (req, reply) => {
    const body = req.body as UserPayload & { password?: string };
    if (!body.password || body.password.length < 4) {
      return reply.code(400).send({ error: 'A password (min 4 characters) is required for new users.' });
    }
    const data = userWriteData({ ...body, email: normEmail(body.email) });
    try {
      const created = await prisma.user.create({
        data: { id: body.id, ...data, passwordHash: await hashPassword(body.password) },
      });
      const rev = await bumpRev();
      return reply.code(201).send({ user: userToJson(created), rev });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return reply.code(409).send({ error: 'A user with that email already exists.' });
      }
      throw e;
    }
  });

  app.put('/api/users/:id', { preHandler: guard, schema: { body: userBody } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as UserPayload & { password?: string };
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: 'User not found.' });

    const data = userWriteData({ ...body, email: normEmail(body.email) });
    const update: Prisma.UserUpdateInput = { ...data };
    if (body.password && body.password.length >= 4) {
      update.passwordHash = await hashPassword(body.password);
    }
    try {
      const saved = await prisma.user.update({ where: { id }, data: update });
      const rev = await bumpRev();
      return reply.send({ user: userToJson(saved), rev });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return reply.code(409).send({ error: 'A user with that email already exists.' });
      }
      throw e;
    }
  });

  app.post('/api/users/:id/password', {
    preHandler: guard,
    schema: {
      body: {
        type: 'object', required: ['password'],
        properties: { password: { type: 'string', minLength: 4, maxLength: 200 } },
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { password } = req.body as { password: string };
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: 'User not found.' });
    await prisma.user.update({ where: { id }, data: { passwordHash: await hashPassword(password) } });
    return reply.send({ ok: true });
  });

  app.delete('/api/users/:id', { preHandler: guard }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (id === req.currentUser!.id) {
      return reply.code(400).send({ error: 'You cannot remove your own account.' });
    }
    await prisma.user.deleteMany({ where: { id } });
    const rev = await bumpRev();
    return reply.send({ ok: true, rev });
  });
}
