import type { FastifyInstance } from 'fastify';
import { Permission } from '../../../src/types/user';
import { VaultSettings } from '../../../src/types/models';
import { loadSettings, saveSettings } from '../repositories/settingsRepo';
import { clearIpLockCache } from '../auth/ipLock';
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

  /**
   * The caller's own current IP, as the server sees it — so a manager setting the
   * office lock can enter the right address ("use my current IP") instead of
   * guessing and locking the team out. This is exactly the IP the lock compares.
   */
  app.get('/api/settings/my-ip', { preHandler: [app.authenticate] }, async (req) => ({ ip: req.ip }));

  app.patch('/api/settings', {
    preHandler: [app.authenticate, app.requirePermission(Permission.editSettings)],
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          // Bounded rather than free integers: a 0-day cooldown would quietly
          // disable a protection.
          notInterestedCooldownDays: { type: 'integer', minimum: 1, maximum: 365 },
          listedCooldownDays: { type: 'integer', minimum: 1, maximum: 365 },
          maxNoAnswerAttempts: { type: 'integer', minimum: 1, maximum: 20 },
          assignmentExpiryDays: { type: 'integer', minimum: 1, maximum: 365 },
          portfolioStaleDays: { type: 'integer', minimum: 1, maximum: 365 },
          officeIp: { type: 'string', maxLength: 64 },
          // Assignment timer. Hours 0–720 (30 days), days 0–365. 0 = no limit
          // (the timer is removed — see dispositions.ts).
          assignmentSlaHours: { type: 'integer', minimum: 0, maximum: 720 },
          noAnswerExtensionHours: { type: 'integer', minimum: 0, maximum: 720 },
          noAnswerMaxHoldDays: { type: 'integer', minimum: 0, maximum: 365 },
          portfolioRenewDays: { type: 'integer', minimum: 0, maximum: 365 },
          expiringSoonHours: { type: 'integer', minimum: 0, maximum: 720 },
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
      body.officeIp ?? current.officeIp,
      body.assignmentSlaHours ?? current.assignmentSlaHours,
      body.noAnswerExtensionHours ?? current.noAnswerExtensionHours,
      body.noAnswerMaxHoldDays ?? current.noAnswerMaxHoldDays,
      body.portfolioRenewDays ?? current.portfolioRenewDays,
      body.expiringSoonHours ?? current.expiringSoonHours,
    );

    await saveSettings(next);
    clearIpLockCache(); // a changed office IP / toggle takes effect at once
    await writeAudit({
      actorId: req.currentUser!.id,
      action: 'settings',
      detail: 'Platform rules updated',
    });

    return serializeSettings(next);
  });
}
