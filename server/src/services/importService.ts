import { transaction } from '../db/pool';
import {
  Property, Lead, DataSet, DataSetType, DataModule,
} from '../../../src/types/models';
import { ImportPipeline, OwnerMode } from '../../../src/logic/importPipeline';
import type { ChangeTally } from '../../../src/logic/importModels';
import { LeadPipeline, LeadColumnSpec, LeadField } from '../../../src/logic/leadPipeline';
import { ColumnSpec, ImportField, ParsedSheet, emptyChangeTally } from '../../../src/logic/importModels';
import { parseVendorFile } from '../../../src/logic/fileParser';
import {
  createStagingSession, findStagingSession, loadStagedSheet, loadStagedPreview,
  markCommitted, dropStagedRows, StagedSession,
} from '../repositories/importRepo';
import {
  retainSource, getDatasetSource, restageFromSource,
} from '../repositories/datasetSourceRepo';
import { findByUnitKeys, saveProperties } from '../repositories/propertyRepo';
import { findByLeadKeys, saveLeads } from '../repositories/leadRepo';
import { insertDataset, findDatasetById, refreshDatasetStats } from '../repositories/datasetRepo';
import { writeAudit } from '../repositories/auditRepo';
import { newImportSessionId, newDatasetId } from '../domain/ids';
import { env } from '../config/env';
import { badRequest, notFound, forbidden, unprocessable } from '../http/errors';

/**
 * The import pipeline.
 *
 * Every calculation here — header detection, column auto-mapping, phone
 * normalisation, unit keys, the register/transactions collapse, the dedupe
 * against existing units — is the frontend's own `ImportPipeline` /
 * `LeadPipeline`, imported, not reimplemented. The server owns *when* it runs
 * and what it's allowed to touch; the maths is identical by construction.
 *
 * ── The bug this fixes ──────────────────────────────────────────────────────
 * The reference wizard generated a dataset id TWICE from the clock:
 *   runDryRun():   datasetId: `ds-${Date.now()}`   → stamped onto every Property
 *   handleCommit(): new DataSet(`ds-${Date.now()}`) → the dataset row
 * Those two calls resolve at different milliseconds, so every imported property
 * pointed at a dataset id that never existed. `deleteDataset` filters
 * `properties.filter(p => p.datasetId === d.id)`, matched nothing, deleted the
 * dataset row and ORPHANED all its owner data — a delete that silently didn't
 * delete, in a product whose whole purpose is controlling owner data.
 *
 * Here the id is minted once, when staging is created, and is the same id used
 * for the rows and the dataset row. It cannot drift because there is only one.
 */

const ALLOWED_EXT = ['.xlsx', '.csv'];

export interface StagedResult {
  sessionId: string;
  fileName: string;
  sheets: { name: string; rowCount: number }[];
  /** Server-detected defaults, so the wizard opens on the same state as before. */
  headerRow: number;
  columns: ColumnSpec[] | LeadColumnSpec[];
  detectedType?: DataSetType;
  preview: unknown[][];
}

/**
 * Parse an upload and stage it. The file's bytes end here — nothing is written
 * to disk and the buffer is released when this returns.
 */
export async function stageUpload(input: {
  fileName: string;
  bytes: Buffer;
  module: DataModule;
  userId: string;
}): Promise<StagedResult> {
  const lower = input.fileName.toLowerCase();
  if (!ALLOWED_EXT.some(e => lower.endsWith(e))) {
    throw badRequest('Upload an Excel (.xlsx) or CSV file exported from a data vendor.');
  }
  if (input.bytes.length === 0) throw badRequest('That file is empty.');
  if (input.bytes.length > env.maxUploadBytes) {
    throw badRequest(`That file is larger than the ${Math.floor(env.maxUploadBytes / 1024 / 1024)}MB limit.`);
  }

  let parsed;
  try {
    // Same parser the browser used — a Buffer is a Uint8Array, which xlsx reads.
    parsed = parseVendorFile(
      input.fileName,
      input.bytes.buffer.slice(
        input.bytes.byteOffset, input.bytes.byteOffset + input.bytes.byteLength,
      ) as ArrayBuffer,
    );
  } catch (err) {
    throw unprocessable('That file could not be read. Is it a valid .xlsx or .csv?');
  }

  const nonEmpty = parsed.nonEmptySheets;
  if (nonEmpty.length === 0) {
    throw unprocessable('That file has no rows of data.');
  }

  // Minted ONCE. See the note at the top of this file.
  const sessionId = newImportSessionId();
  const expiresAt = new Date(Date.now() + env.importSessionTtlMinutes * 60_000);

  await createStagingSession({
    id: sessionId,
    userId: input.userId,
    module: input.module,
    fileName: input.fileName,
    sheets: nonEmpty,
    expiresAt,
  });

  const firstRows = nonEmpty[0].rows;
  const headerRow = ImportPipeline.detectHeaderRow(firstRows);

  if (input.module === DataModule.owners) {
    const columns = ImportPipeline.buildColumns(firstRows, headerRow);
    return {
      sessionId,
      fileName: input.fileName,
      sheets: nonEmpty.map(s => ({ name: s.name, rowCount: s.rows.length })),
      headerRow,
      columns,
      detectedType: ImportPipeline.detectType(columns),
      preview: firstRows.slice(0, 30),
    };
  }

  return {
    sessionId,
    fileName: input.fileName,
    sheets: nonEmpty.map(s => ({ name: s.name, rowCount: s.rows.length })),
    headerRow,
    columns: LeadPipeline.buildColumns(firstRows, headerRow),
    preview: firstRows.slice(0, 30),
  };
}

async function requireOwnedSession(sessionId: string, userId: string): Promise<StagedSession> {
  const session = await findStagingSession(sessionId);
  if (!session) {
    throw notFound('That import has expired. Upload the file again.');
  }
  // Staged rows are unmasked owner data — only the uploader may touch them.
  if (session.userId !== userId) throw forbidden('That import belongs to someone else.');
  if (session.status === 'committed') {
    throw badRequest('That import has already been committed.');
  }
  if (new Date(session.expiresAt) <= new Date()) {
    throw notFound('That import has expired. Upload the file again.');
  }
  return session;
}

/** Re-derive columns for a different header row, against the staged rows. */
export async function rebuildColumns(input: {
  sessionId: string; userId: string; sheetIndex: number; headerRow: number;
}): Promise<{ columns: ColumnSpec[] | LeadColumnSpec[]; detectedType?: DataSetType }> {
  const session = await requireOwnedSession(input.sessionId, input.userId);
  const rows = await loadStagedSheet(input.sessionId, input.sheetIndex);
  if (rows.length === 0) throw notFound('That sheet has no rows.');
  if (input.headerRow < 0 || input.headerRow >= rows.length) {
    throw badRequest('That header row is outside the sheet.');
  }

  if (session.module === DataModule.owners) {
    const columns = ImportPipeline.buildColumns(rows, input.headerRow);
    return { columns, detectedType: ImportPipeline.detectType(columns) };
  }
  return { columns: LeadPipeline.buildColumns(rows, input.headerRow) };
}

export interface OwnerDryRunSummary {
  type: DataSetType;
  sourceRows: number;
  invalidRows: number;
  inFileDuplicates: number;
  newCount: number;
  updatedCount: number;
  uniqueUnits: number;
  callable: number;
  /** What the matched units actually change — surfaced in the update review. */
  changes: ChangeTally;
  /** A masked sample of the new rows, for the review step. */
  sample: {
    owner: string; community: string; unit: string; phone: string;
  }[];
}

/**
 * Dry run, server-side.
 *
 * The client used to compute these numbers and then ask the server (well, the
 * IndexedDB) to trust them. Now the server computes them from the staged rows
 * and its own view of existing units — so the counts the user approves are the
 * counts that will actually happen.
 */
export async function dryRunOwners(input: {
  sessionId: string;
  userId: string;
  sheetIndex: number;
  headerRow: number;
  columns: ColumnSpec[];
  type: DataSetType;
  communityFallback: string;
  /** Update mode preview: matched units keep their own set (mirrors commit). */
  targetDatasetId?: string;
  /** How matched units' owners reconcile with the file (update mode). */
  ownerMode?: OwnerMode;
  /** Re-map preview: corrects existing units in place (mirrors commit). */
  remap?: boolean;
}): Promise<OwnerDryRunSummary> {
  const session = await requireOwnedSession(input.sessionId, input.userId);
  if (session.module !== DataModule.owners) {
    throw badRequest('That import is a buyer-leads file.');
  }

  const updateMode = input.targetDatasetId != null && input.targetDatasetId.length > 0;
  const datasetId = updateMode ? input.targetDatasetId! : input.sessionId;

  const rows = await loadStagedSheet(input.sessionId, input.sheetIndex);
  const sheet = new ParsedSheet(session.sheetNames[input.sheetIndex] ?? 'Sheet1', rows);

  // ── RE-MAP preview: same source re-interpreted, units corrected in place ────
  if (input.remap && updateMode) {
    const plan = await planRemap({
      sheet, headerRow: input.headerRow, datasetId,
      newColumns: input.columns, newType: input.type, newCommunity: input.communityFallback,
    });
    if (plan.error) throw unprocessable(plan.error);
    return {
      type: input.type,
      sourceRows: plan.newUnits.length,
      invalidRows: 0,
      inFileDuplicates: 0,
      // A clean re-map corrects existing units and adds none.
      newCount: plan.newUnits.length - plan.matched,
      updatedCount: plan.matched,
      uniqueUnits: plan.newUnits.length,
      callable: plan.newUnits.filter(p => p.callable).length,
      changes: emptyChangeTally(),
      sample: plan.newUnits.slice(0, 20).map(p => ({
        owner: p.owner.name,
        community: p.community,
        unit: p.unitLabel,
        phone: p.owner.phone ? maskForPreview(p.owner.phone) : '—',
      })),
    };
  }

  // Which existing units this file touches — the dedupe key set. Computed by
  // running the pipeline once with an empty map to learn the unit keys, then
  // loading only those rows rather than the whole table.
  //
  // Yes, this parses the sheet twice. That's deliberate: the alternative is to
  // reimplement the key-extraction half of dryRun() here, which is exactly the
  // duplication that lets server and client drift. Paying one extra in-memory
  // pass beats loading every unit_key in the org, and beats forking the pipeline.
  const probe = ImportPipeline.dryRun({
    sheet, headerRow: input.headerRow, columns: input.columns,
    type: input.type, communityFallback: input.communityFallback,
    datasetId,
    existingByUnitKey: new Map(),
  });
  const touchedKeys = probe.newProperties.map(p => p.unitKey);
  const existingByUnitKey = await findByUnitKeys(touchedKeys);

  const result = ImportPipeline.dryRun({
    sheet, headerRow: input.headerRow, columns: input.columns,
    type: input.type, communityFallback: input.communityFallback,
    datasetId,
    existingByUnitKey,
    keepExistingDataset: updateMode,
    ownerMode: input.ownerMode,
  });

  return {
    type: result.type,
    sourceRows: result.sourceRows,
    invalidRows: result.invalidRows,
    inFileDuplicates: result.inFileDuplicates,
    newCount: result.newProperties.length,
    updatedCount: result.updatedProperties.length,
    uniqueUnits: result.uniqueUnits,
    callable: result.callable,
    changes: result.changes,
    sample: result.newProperties.slice(0, 20).map(p => ({
      owner: p.owner.name,
      community: p.community,
      unit: p.unitLabel,
      // Masked even here: the review step never needed real numbers.
      phone: p.owner.phone ? maskForPreview(p.owner.phone) : '—',
    })),
  };
}

function maskForPreview(phone: string): string {
  if (phone.length < 4) return phone;
  return phone.slice(0, -4).replace(/\d/g, '•') + phone.slice(-4);
}

// ── Re-map (correcting the column mapping of an existing set) ─────────────────
//
// Re-map ≠ update-with-a-new-file. It re-interprets the SAME retained source rows
// with a corrected mapping and fixes the existing units IN PLACE — it must never
// create a duplicate, and it must be able to CORRECT a wrong value (even to blank),
// unlike a blank-keeps update. Identity can't be the unit key here (the whole
// point is the key columns changed), so we match by SOURCE POSITION: run the same
// rows through the OLD mapping (reproducing the current keys, in order) and the NEW
// mapping (the corrected units, in order) and zip them 1:1.

interface RemapPlan {
  oldUnits: Property[];   // units as the CURRENT mapping produced them (source order)
  newUnits: Property[];   // units as the CORRECTED mapping produces them (source order)
  existingByUnitKey: Map<string, Property>;
  matched: number;
  error?: string;
}

async function planRemap(input: {
  sheet: ParsedSheet; headerRow: number; datasetId: string;
  newColumns: ColumnSpec[]; newType: DataSetType; newCommunity: string;
}): Promise<RemapPlan> {
  const source = await getDatasetSource(input.datasetId);
  if (!source) {
    return {
      oldUnits: [], newUnits: [], existingByUnitKey: new Map(), matched: 0,
      error: 'This data set has no retained source to re-map. Re-import it once (after this update) to enable in-app re-mapping.',
    };
  }
  // OLD mapping → the keys the current DB rows already have.
  const oldProbe = ImportPipeline.dryRun({
    sheet: input.sheet, headerRow: source.headerRow, columns: source.columns as ColumnSpec[],
    type: source.type, communityFallback: source.community, datasetId: input.datasetId,
    existingByUnitKey: new Map(),
  });
  // NEW mapping → the corrected units.
  const newProbe = ImportPipeline.dryRun({
    sheet: input.sheet, headerRow: input.headerRow, columns: input.newColumns,
    type: input.newType, communityFallback: input.newCommunity, datasetId: input.datasetId,
    existingByUnitKey: new Map(),
  });
  const oldUnits = oldProbe.newProperties;
  const newUnits = newProbe.newProperties;
  const existingByUnitKey = await findByUnitKeys(oldUnits.map(u => u.unitKey));

  let error: string | undefined;
  if (oldUnits.length !== newUnits.length) {
    error = `The corrected mapping changes how the rows group into units (${oldUnits.length} → ${newUnits.length}). That happens when the unit-number or building column is re-mapped in a way that changes which rows are the same unit — re-check those columns.`;
  } else {
    const seen = new Set<string>();
    for (const u of newUnits) {
      if (seen.has(u.unitKey)) {
        error = 'The corrected mapping makes two different units identical (same building + unit number), which would merge them. Re-check the building and unit columns.';
        break;
      }
      seen.add(u.unitKey);
    }
  }
  const matched = error ? 0 : oldUnits.filter(u => existingByUnitKey.has(u.unitKey)).length;
  return { oldUnits, newUnits, existingByUnitKey, matched, error };
}

/**
 * Build the corrected row for one unit: keep the existing row's IDENTITY-INDEPENDENT
 * work (id, state, assignment, portfolio, calls links, notes, created date) and take
 * every DERIVED field — including the unit key and, crucially, values that are now
 * blank — from the re-interpreted source. This is authoritative on purpose: re-map
 * fixes a mapping mistake, so the source is the truth for the mapped fields.
 */
function remapMerge(existing: Property, cand: Property, now: string): Property {
  const p = Property.fromJson(existing.toJson()); // clone: keeps id/state/assignment/notes/…
  p.unitKey = cand.unitKey;
  p.community = cand.community;
  p.cluster = cand.cluster;
  p.building = cand.building;
  p.unitNumber = cand.unitNumber;
  p.plotNumber = cand.plotNumber;
  p.propertyType = cand.propertyType;
  p.beds = cand.beds;
  p.sizeSqft = cand.sizeSqft;
  p.plotSqft = cand.plotSqft;
  p.lastTransactionDate = cand.lastTransactionDate;
  p.lastTransactionValue = cand.lastTransactionValue;
  p.txCount = cand.txCount;
  p.rentStart = cand.rentStart;
  p.rentEnd = cand.rentEnd;
  p.rentAmount = cand.rentAmount;
  p.owner = cand.owner;
  p.owners = cand.owners;
  p.extra = cand.extra;
  p.updatedAt = now;
  return p;
}

export interface CommitOwnersInput {
  sessionId: string;
  userId: string;
  sheetIndex: number;
  headerRow: number;
  columns: ColumnSpec[];
  type: DataSetType;
  communityFallback: string;
  datasetName: string;
  source: string;
  cost?: number;
  /**
   * Update mode: merge into this existing data set instead of creating a new
   * one. Matched units keep their notes / calls / state / allocations and their
   * own set; genuinely new units join this set; blank cells never overwrite.
   */
  targetDatasetId?: string;
  /** How matched units' owners reconcile with the file (update mode). */
  ownerMode?: OwnerMode;
  /**
   * Re-map mode: this staged data IS the set's own retained source, re-mapped.
   * Correct the existing units in place (matched by source position, not key) —
   * never duplicate — and let corrected values override, even to blank.
   */
  remap?: boolean;
}

/**
 * Commit. Recomputes the import from the staged rows rather than trusting a
 * client-supplied row set, then writes the dataset and its properties in ONE
 * transaction — so a failure halfway can't leave a dataset row pointing at
 * half-imported units.
 */
export async function commitOwners(input: CommitOwnersInput): Promise<{
  datasetId: string; imported: number;
}> {
  const session = await requireOwnedSession(input.sessionId, input.userId);
  if (session.module !== DataModule.owners) {
    throw badRequest('That import is a buyer-leads file.');
  }

  const rows = await loadStagedSheet(input.sessionId, input.sheetIndex);
  const sheet = new ParsedSheet(session.sheetNames[input.sheetIndex] ?? 'Sheet1', rows);

  // Update mode targets an existing set: validate it before touching anything.
  const updateMode = input.targetDatasetId != null && input.targetDatasetId.length > 0;
  const target = updateMode ? await findDatasetById(input.targetDatasetId!) : null;
  if (updateMode && (!target || target.module !== DataModule.owners)) {
    throw notFound('That data set no longer exists — refresh and pick it again.');
  }
  // Create-new mints its own id (the staging id); update merges into the target.
  const datasetId = updateMode ? input.targetDatasetId! : input.sessionId;

  // ── RE-MAP: correct the existing units in place, no duplicates ──────────────
  if (input.remap && updateMode) {
    const plan = await planRemap({
      sheet, headerRow: input.headerRow, datasetId,
      newColumns: input.columns, newType: input.type, newCommunity: input.communityFallback,
    });
    if (plan.error) throw unprocessable(plan.error);

    const now = new Date().toISOString();
    const toSave: Property[] = plan.newUnits.map((cand, i) => {
      const existing = plan.existingByUnitKey.get(plan.oldUnits[i].unitKey);
      // Matched → correct in place (keep work); unmatched (rare — set changed
      // since import) → treat as a new unit rather than silently dropping it.
      return existing ? remapMerge(existing, cand, now) : cand;
    });

    await transaction(async (cx) => {
      await saveProperties(toSave, cx);
      await refreshDatasetStats(datasetId, plan.matched, session.fileName, input.cost, cx);
      await retainSource({
        datasetId, fileName: session.fileName, module: DataModule.owners,
        sheetName: session.sheetNames[input.sheetIndex] ?? 'Sheet1',
        headerRow: input.headerRow, columns: input.columns, type: input.type,
        community: input.communityFallback, rowCount: rows.length,
        sessionId: input.sessionId, sheetIndex: input.sheetIndex,
      }, cx);
      await markCommitted(input.sessionId, cx);
      await dropStagedRows(input.sessionId, cx);
      await writeAudit({
        actorId: input.userId, action: 'edit',
        detail: `Re-mapped columns of "${target!.name}" — ${plan.matched} unit${plan.matched === 1 ? '' : 's'} corrected in place`,
      }, cx);
    });
    return { datasetId, imported: toSave.length };
  }

  const probe = ImportPipeline.dryRun({
    sheet, headerRow: input.headerRow, columns: input.columns,
    type: input.type, communityFallback: input.communityFallback,
    datasetId, existingByUnitKey: new Map(),
  });
  const existingByUnitKey = await findByUnitKeys(probe.newProperties.map(p => p.unitKey));

  const result = ImportPipeline.dryRun({
    sheet, headerRow: input.headerRow, columns: input.columns,
    type: input.type, communityFallback: input.communityFallback,
    datasetId, existingByUnitKey,
    // In update mode a matched unit keeps its own set; new units join `datasetId`.
    keepExistingDataset: updateMode,
    ownerMode: input.ownerMode,
  });

  const all: Property[] = [...result.newProperties, ...result.updatedProperties];

  await transaction(async (cx) => {
    if (updateMode) {
      // Merge in place: matched rows update by id (notes/state/allocations are
      // preserved by copyWith), new rows insert into the target set. Then the
      // set's counts are recomputed — no second data set is created.
      await saveProperties(all, cx);
      await refreshDatasetStats(datasetId, result.updatedProperties.length, session.fileName, input.cost, cx);
      const spend = input.cost && input.cost > 0 ? ` · +${input.cost} spend` : '';
      await writeAudit({
        actorId: input.userId,
        action: 'import',
        detail: `Updated data set "${target!.name}" — ${result.updatedProperties.length} updated, ${result.newProperties.length} added${spend}`,
      }, cx);
    } else {
      const dataset = new DataSet(
        datasetId, input.datasetName, input.source, result.type,
        DataModule.owners, session.fileName, input.communityFallback,
        new Date().toISOString(), input.cost,
        result.uniqueUnits, result.callable, result.updatedProperties.length,
      );
      await insertDataset(dataset, input.userId, cx);
      // `updatedProperties` were built by copyWith from existing rows and keep
      // their original ids, so the upsert updates them in place; new rows insert.
      await saveProperties(all, cx);
      await writeAudit({
        actorId: input.userId,
        action: 'import',
        detail: `Imported "${dataset.name}" — ${dataset.totalUnits} units`,
      }, cx);
    }
    // Keep the parsed source with the data set (replacing any earlier one), so
    // it can be re-downloaded and re-mapped without a re-upload. Copied from the
    // scratchpad before it's dropped just below.
    await retainSource({
      datasetId, fileName: session.fileName, module: DataModule.owners,
      sheetName: session.sheetNames[input.sheetIndex] ?? 'Sheet1',
      headerRow: input.headerRow, columns: input.columns, type: result.type,
      community: input.communityFallback, rowCount: rows.length,
      sessionId: input.sessionId, sheetIndex: input.sheetIndex,
    }, cx);

    await markCommitted(input.sessionId, cx);
    await dropStagedRows(input.sessionId, cx);
  });

  return { datasetId, imported: all.length };
}

export interface RestageResult {
  sessionId: string;
  fileName: string;
  sheets: { name: string; rowCount: number }[];
  headerRow: number;
  columns: ColumnSpec[];
  preview: unknown[][];
  detectedType?: DataSetType;
  /** Re-map always feeds back into the same set, in update mode. */
  targetDatasetId: string;
  type: DataSetType;
  community: string;
}

/**
 * Re-map, without a re-upload: copy a data set's retained source into a fresh
 * staging session and hand it back in the same shape as a just-uploaded file.
 * The wizard then drives its normal update flow against it — only nobody had to
 * find the file again.
 */
export async function restageDatasetForRemap(datasetId: string, userId: string): Promise<RestageResult> {
  const source = await getDatasetSource(datasetId);
  if (!source) {
    throw notFound('No stored file for this data set — it was imported before file-keeping was enabled. Re-import it to enable re-mapping.');
  }
  if (source.module !== DataModule.owners) {
    throw badRequest('Only owner data sets can be re-mapped here.');
  }

  const newSessionId = newImportSessionId();
  const expiresAt = new Date(Date.now() + env.importSessionTtlMinutes * 60_000);
  await transaction(async (cx) => {
    await restageFromSource({ datasetId, newSessionId, userId, source, expiresAt }, cx);
  });

  const preview = await loadStagedPreview(newSessionId, 0, 30);
  return {
    sessionId: newSessionId,
    fileName: source.fileName,
    sheets: [{ name: source.sheetName, rowCount: source.rowCount }],
    headerRow: source.headerRow,
    columns: source.columns,
    preview,
    detectedType: source.type,
    targetDatasetId: datasetId,
    type: source.type,
    community: source.community,
  };
}

// ── Leads ──────────────────────────────────────────────────────────────────

export interface LeadDryRunSummary {
  sourceRows: number;
  invalidRows: number;
  inFileDuplicates: number;
  newCount: number;
  updatedCount: number;
  uniqueLeads: number;
  callable: number;
}

export async function dryRunLeads(input: {
  sessionId: string; userId: string; sheetIndex: number;
  headerRow: number; columns: LeadColumnSpec[];
}): Promise<LeadDryRunSummary> {
  const session = await requireOwnedSession(input.sessionId, input.userId);
  if (session.module !== DataModule.leads) {
    throw badRequest('That import is an owners file.');
  }

  const rows = await loadStagedSheet(input.sessionId, input.sheetIndex);
  const sheet = new ParsedSheet(session.sheetNames[input.sheetIndex] ?? 'Sheet1', rows);

  const probe = LeadPipeline.dryRun({
    sheet, headerRow: input.headerRow, columns: input.columns,
    datasetId: input.sessionId, existingByKey: new Map(),
  });
  const existingByKey = await findByLeadKeys(probe.newLeads.map(l => l.leadKey));

  const result = LeadPipeline.dryRun({
    sheet, headerRow: input.headerRow, columns: input.columns,
    datasetId: input.sessionId, existingByKey,
  });

  return {
    sourceRows: result.sourceRows,
    invalidRows: result.invalidRows,
    inFileDuplicates: result.inFileDuplicates,
    newCount: result.newLeads.length,
    updatedCount: result.updatedLeads.length,
    uniqueLeads: result.uniqueLeads,
    callable: result.callable,
  };
}

export async function commitLeads(input: {
  sessionId: string; userId: string; sheetIndex: number;
  headerRow: number; columns: LeadColumnSpec[];
  datasetName: string; source: string; cost?: number;
}): Promise<{ datasetId: string; imported: number }> {
  const session = await requireOwnedSession(input.sessionId, input.userId);
  if (session.module !== DataModule.leads) {
    throw badRequest('That import is an owners file.');
  }

  const rows = await loadStagedSheet(input.sessionId, input.sheetIndex);
  const sheet = new ParsedSheet(session.sheetNames[input.sheetIndex] ?? 'Sheet1', rows);

  const probe = LeadPipeline.dryRun({
    sheet, headerRow: input.headerRow, columns: input.columns,
    datasetId: input.sessionId, existingByKey: new Map(),
  });
  const existingByKey = await findByLeadKeys(probe.newLeads.map(l => l.leadKey));

  const result = LeadPipeline.dryRun({
    sheet, headerRow: input.headerRow, columns: input.columns,
    datasetId: input.sessionId, existingByKey,
  });

  const all: Lead[] = [...result.newLeads, ...result.updatedLeads];
  const datasetId = input.sessionId;

  const dataset = new DataSet(
    datasetId, input.datasetName, input.source,
    DataSetType.register, DataModule.leads, session.fileName,
    '', new Date().toISOString(), input.cost,
    result.uniqueLeads, result.callable, result.updatedLeads.length,
  );

  await transaction(async (cx) => {
    await insertDataset(dataset, input.userId, cx);
    await saveLeads(all, cx);
    await markCommitted(input.sessionId, cx);
    await dropStagedRows(input.sessionId, cx);
    await writeAudit({
      actorId: input.userId, action: 'import',
      detail: `Imported leads "${dataset.name}" — ${dataset.totalUnits} enquiries`,
    }, cx);
  });

  return { datasetId, imported: all.length };
}
