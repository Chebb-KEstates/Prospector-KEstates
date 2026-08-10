import type { FastifyInstance } from 'fastify';
import { Permission } from '../../../src/types/user';
import { listActivity } from '../repositories/auditRepo';
import { listUsers } from '../repositories/userRepo';
import { buildActivityWorkbook } from '../services/exportService';
import { writeAudit } from '../repositories/auditRepo';

/**
 * The activity log (audit + call records, enriched). Read-only over HTTP — there
 * is no route that writes or edits an entry; entries are written as a side effect
 * of the thing they record, inside its transaction. The export is masked: no real
 * phone number ever leaves in a file.
 */

const querystring = {
  type: 'object', additionalProperties: false,
  properties: {
    actorId: { type: 'string', maxLength: 64 },
    action: { type: 'string', maxLength: 64 },
    from: { type: 'string', maxLength: 32 },   // yyyy-mm-dd (inclusive)
    to: { type: 'string', maxLength: 32 },     // yyyy-mm-dd (inclusive)
    search: { type: 'string', maxLength: 120 },
    sort: { type: 'string', enum: ['at', 'actor', 'action'] },
    dir: { type: 'string', enum: ['asc', 'desc'] },
    page: { type: 'integer', minimum: 0 },
    pageSize: { type: 'integer', minimum: 1, maximum: 200 },
  },
} as const;

interface AuditQuery {
  actorId?: string; action?: string; from?: string; to?: string;
  search?: string; sort?: 'at' | 'actor' | 'action'; dir?: 'asc' | 'desc';
  page?: number; pageSize?: number;
}

/** A yyyy-mm-dd string → UTC day bounds; `to` is made inclusive (+1 day). */
function bounds(from?: string, to?: string): { from?: Date; to?: Date } {
  const parse = (s?: string) => {
    if (!s) return undefined;
    const d = new Date(`${s}T00:00:00.000Z`);
    return isNaN(d.getTime()) ? undefined : d;
  };
  const f = parse(from);
  const t = parse(to);
  return { from: f, to: t ? new Date(t.getTime() + 24 * 3600_000) : undefined };
}

export default async function auditRoutes(app: FastifyInstance) {
  app.get('/api/audit', {
    preHandler: [app.authenticate, app.requirePermission(Permission.viewReports)],
    schema: { querystring },
  }, async (req) => {
    const q = req.query as AuditQuery;
    const pageSize = q.pageSize ?? 100;
    const page = q.page ?? 0;
    const { from, to } = bounds(q.from, q.to);

    const result = await listActivity({
      limit: pageSize,
      offset: page * pageSize,
      actorId: q.actorId,
      action: q.action,
      from, to,
      search: q.search,
      sort: q.sort,
      dir: q.dir,
    });

    return { rows: result.rows, total: result.total, page, pageSize };
  });

  /** Excel export of the filtered activity — numbers masked, manager-only, audited. */
  app.get('/api/audit/export', {
    preHandler: [app.authenticate, app.requirePermission(Permission.viewReports)],
    schema: { querystring },
  }, async (req, reply) => {
    const q = req.query as AuditQuery;
    const { from, to } = bounds(q.from, q.to);

    // Cap the export so a runaway request can't try to build a million-row sheet.
    const result = await listActivity({
      limit: 10000, offset: 0,
      actorId: q.actorId, action: q.action, from, to,
      search: q.search, sort: q.sort, dir: q.dir,
    });

    const users = await listUsers();
    const nameById = new Map(users.map(u => [u.id, u.name]));
    const actorName = (id: string | null) => (id ? nameById.get(id) ?? id : '—');

    const { buffer, fileName } = buildActivityWorkbook(result.rows, actorName);

    await writeAudit({
      actorId: req.currentUser!.id,
      action: 'export',
      detail: `Exported activity log (${result.rows.length} rows)`,
    });

    const asciiName = fileName.replace(/[^\x20-\x7e]+/g, '_').replace(/["\\]/g, '');
    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="${asciiName}"`)
      .send(buffer);
  });
}
