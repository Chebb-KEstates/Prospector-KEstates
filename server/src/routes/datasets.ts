import type { FastifyInstance } from 'fastify';
import { Permission } from '../../../src/types/user';
import { DataModule } from '../../../src/types/models';
import { transaction } from '../db/pool';
import { listDatasets, findDatasetById, deleteDataset, updateDatasetMeta } from '../repositories/datasetRepo';
import { deleteByDataset, countByDataset } from '../repositories/propertyRepo';
import { deleteLeadsByDataset, countLeadsByDataset } from '../repositories/leadRepo';
import { writeAudit } from '../repositories/auditRepo';
import { buildDatasetWorkbook } from '../services/exportService';
import { serializeDataset } from '../http/serializers';
import { notFound } from '../http/errors';

export default async function datasetRoutes(app: FastifyInstance) {
  app.get('/api/datasets', {
    preHandler: [app.authenticate, app.requirePermission(Permission.manageData)],
  }, async () => (await listDatasets()).map(serializeDataset));

  /**
   * Delete a data set and everything it brought in.
   *
   * This is the route the reference implementation could not actually perform.
   * Its wizard minted `ds-${Date.now()}` twice — once for the rows, once for the
   * DataSet — so `properties.filter(p => p.datasetId === d.id)` matched nothing:
   * the dataset row vanished and every unit it imported stayed behind,
   * orphaned, while the UI reported success. With one id (minted at staging)
   * the join resolves, and the delete happens in a transaction so the dataset
   * row and its data cannot come apart.
   */
  /**
   * Export a data set to Excel — its current units plus every call, feedback
   * note and key event. Manager-only and audited; the workbook is built from
   * stored data so it always reflects the latest state.
   */
  app.get('/api/datasets/:id/export', {
    preHandler: [app.authenticate, app.requirePermission(Permission.manageData)],
    schema: {
      params: {
        type: 'object', required: ['id'],
        properties: { id: { type: 'string', maxLength: 64 } },
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const ds = await findDatasetById(id);
    if (!ds) throw notFound('That data set no longer exists.');

    const { buffer, fileName } = await buildDatasetWorkbook(id);
    await writeAudit({
      actorId: req.currentUser!.id,
      action: 'export',
      detail: `Exported data set "${ds.name}"`,
    });

    // Keep the filename header ASCII-safe; the client sets the real name too.
    const asciiName = fileName.replace(/[^\x20-\x7e]+/g, '_').replace(/["\\]/g, '');
    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="${asciiName}"`)
      .send(buffer);
  });

  /**
   * Edit a data set's own details — name, source, community label and the price
   * paid. This is the safe, in-place "edit" a manager reaches for to fix a typo
   * or record what the data cost. It never touches the imported rows or the
   * counts; re-mapping columns is a re-upload (the wizard's Update mode).
   */
  app.patch('/api/datasets/:id', {
    preHandler: [app.authenticate, app.requirePermission(Permission.manageData)],
    schema: {
      params: {
        type: 'object', required: ['id'],
        properties: { id: { type: 'string', maxLength: 64 } },
      },
      body: {
        type: 'object', additionalProperties: false,
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 200 },
          source: { type: 'string', maxLength: 200 },
          communityLabel: { type: 'string', maxLength: 200 },
          cost: { type: ['number', 'null'], minimum: 0 },
        },
      },
    },
  }, async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as {
      name?: string; source?: string; communityLabel?: string; cost?: number | null;
    };
    const dataset = await findDatasetById(id);
    if (!dataset) throw notFound('That data set no longer exists.');

    await updateDatasetMeta(id, {
      name: body.name?.trim(),
      source: body.source?.trim(),
      communityLabel: body.communityLabel?.trim(),
      cost: body.cost,
    });

    const updated = (await findDatasetById(id))!;
    await writeAudit({
      actorId: req.currentUser!.id,
      action: 'edit',
      detail: `Edited data set "${updated.name}"`,
    });
    return serializeDataset(updated);
  });

  app.delete('/api/datasets/:id', {
    preHandler: [app.authenticate, app.requirePermission(Permission.manageData)],
    schema: {
      params: {
        type: 'object', required: ['id'],
        properties: { id: { type: 'string', maxLength: 64 } },
      },
    },
  }, async (req) => {
    const { id } = req.params as { id: string };
    const dataset = await findDatasetById(id);
    if (!dataset) throw notFound('That data set no longer exists.');

    return transaction(async (cx) => {
      const isLeads = dataset.module === DataModule.leads;

      const removedUnits = isLeads ? 0 : await countByDataset(id, cx);
      const removedLeads = isLeads ? await countLeadsByDataset(id, cx) : 0;

      if (isLeads) await deleteLeadsByDataset(id, cx);
      else await deleteByDataset(id, cx);

      await deleteDataset(id, cx);

      await writeAudit({
        actorId: req.currentUser!.id,
        action: 'delete',
        detail: `Deleted data set "${dataset.name}" — ` +
          `${isLeads ? `${removedLeads} leads` : `${removedUnits} units`} removed`,
      }, cx);

      return { deleted: true, removedUnits, removedLeads };
    });
  });
}
