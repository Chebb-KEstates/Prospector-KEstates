import type { FastifyInstance } from 'fastify';
import { Permission } from '../../../src/types/user';
import { DataModule, DataSetType } from '../../../src/types/models';
import { ImportField } from '../../../src/logic/importModels';
import { LeadField } from '../../../src/logic/leadPipeline';
import {
  stageUpload, rebuildColumns, dryRunOwners, commitOwners,
  dryRunLeads, commitLeads,
} from '../services/importService';
import { badRequest, payloadTooLarge } from '../http/errors';
import { env } from '../config/env';

/**
 * The import wizard's API.
 *
 * Upload once → the server parses and stages the rows → the client re-maps and
 * re-previews against the staged rows → commit. The uploaded bytes are never
 * written to disk and are released as soon as the parse returns; the staged rows
 * are dropped at commit and swept if the wizard is abandoned.
 */

const columnSpecSchema = {
  type: 'array',
  maxItems: 500,
  items: {
    type: 'object',
    required: ['index', 'header', 'field'],
    additionalProperties: true,
    properties: {
      index: { type: 'integer', minimum: 0, maximum: 10000 },
      header: { type: 'string', maxLength: 255 },
      field: { type: 'string', maxLength: 32 },
      filled: { type: 'integer' },
      sampled: { type: 'integer' },
      samples: { type: 'array', items: { type: 'string' } },
    },
  },
} as const;

/**
 * Column specs arrive from the client, so the `field` on each is untrusted.
 * Anything not in the enum becomes `ignore` rather than reaching the pipeline —
 * a bad value here would otherwise silently mis-map a column of owner data.
 */
function sanitizeOwnerColumns(raw: unknown[]): import('../../../src/logic/importModels').ColumnSpec[] {
  const valid = new Set(Object.values(ImportField) as string[]);
  return raw.map((c) => {
    const o = c as Record<string, unknown>;
    return {
      index: Number(o.index),
      header: String(o.header ?? ''),
      field: valid.has(String(o.field)) ? (o.field as ImportField) : ImportField.ignore,
      filled: Number(o.filled ?? 0),
      sampled: Number(o.sampled ?? 0),
      samples: Array.isArray(o.samples) ? (o.samples as unknown[]).map(String) : [],
    };
  }) as import('../../../src/logic/importModels').ColumnSpec[];
}

function sanitizeLeadColumns(raw: unknown[]): import('../../../src/logic/leadPipeline').LeadColumnSpec[] {
  const valid = new Set(Object.values(LeadField) as string[]);
  return raw.map((c) => {
    const o = c as Record<string, unknown>;
    return {
      index: Number(o.index),
      header: String(o.header ?? ''),
      field: valid.has(String(o.field)) ? (o.field as LeadField) : LeadField.ignore,
      filled: Number(o.filled ?? 0),
      sampled: Number(o.sampled ?? 0),
      samples: Array.isArray(o.samples) ? (o.samples as unknown[]).map(String) : [],
    };
  }) as import('../../../src/logic/leadPipeline').LeadColumnSpec[];
}

export default async function importRoutes(app: FastifyInstance) {
  /** Upload + stage. Multipart: one file, plus a `module` field. */
  app.post('/api/imports', {
    preHandler: [app.authenticate, app.requirePermission(Permission.manageData)],
    config: { rateLimit: { max: 20, timeWindow: '5 minutes' } },
  }, async (req) => {
    const file = await req.file();
    if (!file) throw badRequest('No file was uploaded.');

    const moduleField = (file.fields as Record<string, unknown> | undefined)?.module;
    const moduleValue =
      moduleField && typeof moduleField === 'object' && 'value' in (moduleField as object)
        ? String((moduleField as { value: unknown }).value)
        : DataModule.owners;
    const module = moduleValue === DataModule.leads ? DataModule.leads : DataModule.owners;

    let bytes: Buffer;
    try {
      bytes = await file.toBuffer();
    } catch (err) {
      if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
        throw payloadTooLarge(
          `That file is larger than the ${Math.floor(env.maxUploadBytes / 1024 / 1024)}MB limit.`,
        );
      }
      throw err;
    }

    // `file.truncated` is how @fastify/multipart reports hitting the limit when
    // it doesn't throw — without this the import would silently drop rows.
    if (file.file.truncated) {
      throw payloadTooLarge(
        `That file is larger than the ${Math.floor(env.maxUploadBytes / 1024 / 1024)}MB limit.`,
      );
    }

    return stageUpload({
      fileName: file.filename,
      bytes,
      module,
      userId: req.currentUser!.id,
    });
  });

  /** Re-derive the columns for a different header row. */
  app.post('/api/imports/:id/columns', {
    preHandler: [app.authenticate, app.requirePermission(Permission.manageData)],
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', maxLength: 64 } } },
      body: {
        type: 'object', required: ['headerRow'], additionalProperties: false,
        properties: {
          sheetIndex: { type: 'integer', minimum: 0, maximum: 100 },
          headerRow: { type: 'integer', minimum: 0, maximum: 10000 },
        },
      },
    },
  }, async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as { sheetIndex?: number; headerRow: number };
    return rebuildColumns({
      sessionId: id,
      userId: req.currentUser!.id,
      sheetIndex: body.sheetIndex ?? 0,
      headerRow: body.headerRow,
    });
  });

  app.post('/api/imports/:id/dry-run', {
    preHandler: [app.authenticate, app.requirePermission(Permission.manageData)],
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', maxLength: 64 } } },
      body: {
        type: 'object', required: ['headerRow', 'columns'], additionalProperties: false,
        properties: {
          sheetIndex: { type: 'integer', minimum: 0, maximum: 100 },
          headerRow: { type: 'integer', minimum: 0, maximum: 10000 },
          columns: columnSpecSchema,
          type: { type: 'string', enum: Object.values(DataSetType) },
          communityFallback: { type: 'string', maxLength: 255 },
        },
      },
    },
  }, async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as {
      sheetIndex?: number; headerRow: number; columns: unknown[];
      type?: DataSetType; communityFallback?: string;
    };
    const userId = req.currentUser!.id;
    const sheetIndex = body.sheetIndex ?? 0;

    if (body.type) {
      return dryRunOwners({
        sessionId: id, userId, sheetIndex, headerRow: body.headerRow,
        columns: sanitizeOwnerColumns(body.columns),
        type: body.type,
        communityFallback: body.communityFallback ?? '',
      });
    }
    return dryRunLeads({
      sessionId: id, userId, sheetIndex, headerRow: body.headerRow,
      columns: sanitizeLeadColumns(body.columns),
    });
  });

  app.post('/api/imports/:id/commit', {
    preHandler: [app.authenticate, app.requirePermission(Permission.manageData)],
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', maxLength: 64 } } },
      body: {
        type: 'object',
        required: ['headerRow', 'columns', 'datasetName'],
        additionalProperties: false,
        properties: {
          sheetIndex: { type: 'integer', minimum: 0, maximum: 100 },
          headerRow: { type: 'integer', minimum: 0, maximum: 10000 },
          columns: columnSpecSchema,
          type: { type: 'string', enum: Object.values(DataSetType) },
          communityFallback: { type: 'string', maxLength: 255 },
          datasetName: { type: 'string', minLength: 1, maxLength: 255 },
          source: { type: 'string', maxLength: 255 },
          cost: { type: 'number', minimum: 0, maximum: 1e12 },
        },
      },
    },
  }, async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as {
      sheetIndex?: number; headerRow: number; columns: unknown[];
      type?: DataSetType; communityFallback?: string;
      datasetName: string; source?: string; cost?: number;
    };
    const userId = req.currentUser!.id;
    const sheetIndex = body.sheetIndex ?? 0;

    if (body.type) {
      return commitOwners({
        sessionId: id, userId, sheetIndex, headerRow: body.headerRow,
        columns: sanitizeOwnerColumns(body.columns),
        type: body.type,
        communityFallback: body.communityFallback ?? '',
        datasetName: body.datasetName.trim(),
        source: body.source ?? '',
        cost: body.cost,
      });
    }
    return commitLeads({
      sessionId: id, userId, sheetIndex, headerRow: body.headerRow,
      columns: sanitizeLeadColumns(body.columns),
      datasetName: body.datasetName.trim(),
      source: body.source ?? '',
    });
  });
}
