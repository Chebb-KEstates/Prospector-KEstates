import type { FastifyInstance } from 'fastify';
import { Permission } from '../../../src/types/user';
import { env } from '../config/env';
import { transaction } from '../db/pool';
import { randomBytes } from 'crypto';
import { writeAudit } from '../repositories/auditRepo';
import {
  listSearchFiles, findSearchFile, findSearchFileByName, readSearchFileContent,
  insertSearchFile, deleteSearchFile, searchRows, searchStats,
} from '../repositories/masterSearchRepo';
import { parseSearchFile, extensionOf } from '../services/masterSearchService';
import { badRequest, conflict, notFound, payloadTooLarge } from '../http/errors';

/**
 * Master Search.
 *
 *  - Everyone signed in may SEARCH (and see which files are loaded).
 *  - Admins — the "Import & delete data" permission — may also upload a file,
 *    download its original, and delete it (with every row read from it).
 *
 * Searches, uploads, downloads and deletes are written to the audit trail.
 */

const RESULT_LIMIT = 500;
const MAX_TERMS = 10;

const CONTENT_TYPES: Record<string, string> = {
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xlsm': 'application/vnd.ms-excel.sheet.macroEnabled.12',
  '.xls': 'application/vnd.ms-excel',
  '.csv': 'text/csv',
};

const idParams = {
  type: 'object', required: ['id'], properties: { id: { type: 'string', maxLength: 64 } },
} as const;

export default async function masterSearchRoutes(app: FastifyInstance) {
  /** Rows containing every word of `q` (any column, any order, case-insensitive). */
  app.get('/api/master-search', {
    preHandler: [app.authenticate],
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: { q: { type: 'string', maxLength: 200 } },
      },
    },
  }, async (req) => {
    const q = String((req.query as { q?: string }).q ?? '').trim();
    const terms = Array.from(new Set(q.toLowerCase().split(/\s+/).filter(Boolean))).slice(0, MAX_TERMS);
    if (terms.length === 0) return { query: q, total: 0, limit: RESULT_LIMIT, results: [] };
    const { total, hits } = await searchRows(terms, RESULT_LIMIT);
    await writeAudit({
      actorId: req.currentUser!.id, action: 'search',
      detail: `Master search "${q.slice(0, 120)}" — ${total} row${total === 1 ? '' : 's'}`,
    });
    return { query: q, total, limit: RESULT_LIMIT, results: hits };
  });

  /** The loaded files (no contents) and totals. */
  app.get('/api/master-search/files', {
    preHandler: [app.authenticate],
  }, async () => {
    const [files, stats] = await Promise.all([listSearchFiles(), searchStats()]);
    return { files, totalFiles: stats.files, totalRows: stats.rows };
  });

  /** Upload a spreadsheet: keep the original, read every sheet into rows. */
  app.post('/api/master-search/files', {
    preHandler: [app.authenticate, app.requirePermission(Permission.manageData)],
    // Batches upload one file at a time; the client waits out a 429 and retries.
    config: { rateLimit: { max: 300, timeWindow: '5 minutes' } },
  }, async (req) => {
    const file = await req.file();
    if (!file) throw badRequest('No file was uploaded.');
    const tooBig = () => payloadTooLarge(
      `That file is larger than the ${Math.floor(env.maxUploadBytes / 1024 / 1024)}MB limit.`);
    let bytes: Buffer;
    try {
      bytes = await file.toBuffer();
    } catch (err) {
      if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') throw tooBig();
      throw err;
    }
    if (file.file.truncated) throw tooBig();

    const fileName = (file.filename ?? '').trim().slice(0, 255);
    if (!fileName) throw badRequest('The file has no name.');
    const parsed = parseSearchFile(fileName, bytes);
    const id = `sf-${Date.now().toString(36)}${randomBytes(10).toString('hex')}`;

    await transaction(async (cx) => {
      // One file per name, so the same rows never show up twice; replacing a
      // file is an explicit delete + upload.
      if (await findSearchFileByName(fileName, cx)) {
        throw conflict(`A file named "${fileName}" is already loaded. Delete it first to replace it.`);
      }
      await insertSearchFile({
        id, fileName, content: bytes,
        contentType: CONTENT_TYPES[extensionOf(fileName)] ?? 'application/octet-stream',
        sheetCount: parsed.sheetCount, rows: parsed.rows, uploadedBy: req.currentUser!.id,
      }, cx);
      await writeAudit({
        actorId: req.currentUser!.id, action: 'import',
        detail: `Master search: uploaded "${fileName}" — ${parsed.rows.length} rows from ${parsed.sheetCount} sheet(s)`,
      }, cx);
    });
    return findSearchFile(id);
  });

  /** The original file, exactly as uploaded. */
  app.get('/api/master-search/files/:id/download', {
    preHandler: [app.authenticate, app.requirePermission(Permission.manageData)],
    schema: { params: idParams },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const f = await readSearchFileContent(id);
    if (!f) throw notFound('That file is no longer loaded.');
    await writeAudit({
      actorId: req.currentUser!.id, action: 'export',
      detail: `Master search: downloaded "${f.meta.fileName}"`,
    });
    const ascii = f.meta.fileName.replace(/[^\x20-\x7e]+/g, '_').replace(/["\\]/g, '');
    return reply
      .header('Content-Type', f.meta.contentType)
      .header('Content-Disposition',
        `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(f.meta.fileName)}`)
      .send(f.content);
  });

  /** Delete a file and every row read from it. */
  app.delete('/api/master-search/files/:id', {
    preHandler: [app.authenticate, app.requirePermission(Permission.manageData)],
    schema: { params: idParams },
  }, async (req) => {
    const { id } = req.params as { id: string };
    const meta = await findSearchFile(id);
    if (!meta) throw notFound('That file is no longer loaded.');
    const removedRows = await transaction(async (cx) => {
      const n = await deleteSearchFile(id, cx);
      await writeAudit({
        actorId: req.currentUser!.id, action: 'delete',
        detail: `Master search: deleted "${meta.fileName}" and its ${n} rows`,
      }, cx);
      return n;
    });
    return { removedRows };
  });
}
