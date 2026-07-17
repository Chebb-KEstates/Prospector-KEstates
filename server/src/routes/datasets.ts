import type { FastifyInstance } from 'fastify';
import { Permission } from '../../../src/types/user';
import { DataModule } from '../../../src/types/models';
import { transaction } from '../db/pool';
import { listDatasets, findDatasetById, deleteDataset } from '../repositories/datasetRepo';
import { deleteByDataset, countByDataset } from '../repositories/propertyRepo';
import { deleteLeadsByDataset, countLeadsByDataset } from '../repositories/leadRepo';
import { writeAudit } from '../repositories/auditRepo';
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
