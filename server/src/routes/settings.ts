import type { FastifyInstance } from 'fastify';
import { Permission } from '../../../src/types/user';
import { VaultSettings } from '../../../src/types/models';
import { loadSettings, saveSettings } from '../repositories/settingsRepo';
import { writeAudit } from '../repositories/auditRepo';
import { serializeSettings } from '../http/serializers';

/**
 * Platform rules.
 *
 * Readable by anyone signed in (the UI needs the cooldown windows to explain
 * itself), writable only with editSettings. These values feed `applyOutcome`
 * and the reveal cap, so a write here is a security change, not a preference —
 * hence the audit entry and the bounded ranges.
 */
export default async function settingsRoutes(app: FastifyInstance) {
  app.get('/api/settings', { preHandler: [app.authenticate] }, async () =>
    serializeSettings(await loadSettings()));

  app.patch('/api/settings', {
    preHandler: [app.authenticate, app.requirePermission(Permission.editSettings)],
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          // Bounded rather than free integers: a 0-day cooldown or a
          // 100k view cap would quietly disable a protection.
          notInterestedCooldownDays: { type: 'integer', minimum: 1, maximum: 365 },
          listedCooldownDays: { type: 'integer', minimum: 1, maximum: 365 },
          maxNoAnswerAttempts: { type: 'integer', minimum: 1, maximum: 20 },
          assignmentExpiryDays: { type: 'integer', minimum: 1, maximum: 365 },
          portfolioStaleDays: { type: 'integer', minimum: 1, maximum: 365 },
          dailyViewCap: { type: 'integer', minimum: 1, maximum: 10000 },
          wifiLockEnabled: { type: 'boolean' },
          officeIp: { type: 'string', maxLength: 64 },
        },
      },
    },
  }, async (req) => {
    const body = req.body as Partial<VaultSettings>;
    const current = await loadSettings();

    const next = new VaultSettings(
      body.notInterestedCooldownDays ?? current.notInterestedCooldownDays,
      body.listedCooldownDays ?? current.listedCooldownDays,
      body.maxNoAnswerAttempts ?? current.maxNoAnswerAttempts,
      body.assignmentExpiryDays ?? current.assignmentExpiryDays,
      body.portfolioStaleDays ?? current.portfolioStaleDays,
      body.dailyViewCap ?? current.dailyViewCap,
      body.wifiLockEnabled ?? current.wifiLockEnabled,
      body.officeIp ?? current.officeIp,
    );

    await saveSettings(next);
    await writeAudit({
      actorId: req.currentUser!.id,
      action: 'settings',
      detail: 'Platform rules updated',
    });

    return serializeSettings(next);
  });
}
