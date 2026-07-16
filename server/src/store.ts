/**
 * Persistence helpers over Prisma. This is the server-side analogue of the
 * frontend's `LocalVaultRepository` — same operations, now durable in MySQL.
 * Every mutation bumps a global revision counter so other devices can detect
 * changes by polling `GET /api/vault/rev`.
 */
import { prisma } from './db';
import { config } from './config';
import {
  datasetToJson, datasetWriteData, propertyToJson, propertyWriteData,
  leadToJson, leadWriteData, callToJson, callWriteData, requestToJson,
  requestWriteData, auditToJson, auditWriteData, settingsToJson,
  settingsWriteData, userToJson,
} from './domain/mappers';

const CHUNK = 1000;

function chunk<T>(arr: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ---------- revision ----------

export async function bumpRev(): Promise<string> {
  const row = await prisma.meta.upsert({
    where: { id: 'rev' },
    create: { id: 'rev', rev: BigInt(1) },
    update: { rev: { increment: 1 } },
  });
  return row.rev.toString();
}

export async function getRev(): Promise<string> {
  const row = await prisma.meta.findUnique({ where: { id: 'rev' } });
  return (row?.rev ?? BigInt(0)).toString();
}

// ---------- snapshot ----------

const ciName = (a: { name: string }, b: { name: string }) =>
  a.name.toLowerCase().localeCompare(b.name.toLowerCase());

export async function loadSnapshot() {
  const [datasets, properties, leads, calls, requests, settingsRow, audit, users] =
    await Promise.all([
      prisma.dataSet.findMany(),
      prisma.property.findMany(),
      prisma.lead.findMany(),
      prisma.callLog.findMany(),
      prisma.batchRequest.findMany(),
      prisma.settings.findUnique({ where: { id: config.orgId } }),
      prisma.auditEntry.findMany(),
      prisma.user.findMany(),
    ]);

  const defaultSettings = {
    notInterestedCooldownDays: 30, listedCooldownDays: 30, maxNoAnswerAttempts: 3,
    assignmentExpiryDays: 14, portfolioStaleDays: 21, dailyViewCap: 100,
    wifiLockEnabled: false, officeIp: '',
  };

  // Ordering mirrors the frontend's `VaultRepository.load()` exactly.
  return {
    datasets: datasets.map(datasetToJson)
      .sort((a: any, b: any) => String(b.importedAt).localeCompare(String(a.importedAt))),
    properties: properties.map(propertyToJson),
    leads: leads.map(leadToJson),
    calls: calls.map(callToJson)
      .sort((a: any, b: any) => String(b.at).localeCompare(String(a.at))),
    requests: requests.map(requestToJson)
      .sort((a: any, b: any) => String(b.at).localeCompare(String(a.at))),
    settings: settingsRow ? settingsToJson(settingsRow) : defaultSettings,
    audit: audit.map(auditToJson)
      .sort((a: any, b: any) => String(b.at).localeCompare(String(a.at))),
    users: users.map(userToJson).sort(ciName as any),
  };
}

// ---------- datasets + bulk rows ----------

export async function upsertDataset(j: Record<string, any>) {
  const data = datasetWriteData(j);
  await prisma.dataSet.upsert({ where: { id: j.id }, create: { id: j.id, ...data }, update: data });
}

export async function upsertProperties(list: Record<string, any>[]) {
  for (const group of chunk(list)) {
    await prisma.$transaction(
      group.map(j => {
        const data = propertyWriteData(j);
        return prisma.property.upsert({ where: { id: j.id }, create: { id: j.id, ...data }, update: data });
      }),
    );
  }
}

export async function upsertLeads(list: Record<string, any>[]) {
  for (const group of chunk(list)) {
    await prisma.$transaction(
      group.map(j => {
        const data = leadWriteData(j);
        return prisma.lead.upsert({ where: { id: j.id }, create: { id: j.id, ...data }, update: data });
      }),
    );
  }
}

export async function commitPropertyImport(dataset: Record<string, any>, properties: Record<string, any>[]): Promise<string> {
  await upsertDataset(dataset);
  await upsertProperties(properties);
  return bumpRev();
}

export async function commitLeadImport(dataset: Record<string, any>, leads: Record<string, any>[]): Promise<string> {
  await upsertDataset(dataset);
  await upsertLeads(leads);
  return bumpRev();
}

export async function deleteDataset(datasetId: string, propertyIds: string[], leadIds: string[]): Promise<string> {
  // Delete authoritatively by datasetId (fixes the original client-side
  // orphaning bug) and also honour any explicit ids the client sent.
  await prisma.$transaction([
    prisma.property.deleteMany({ where: { datasetId } }),
    prisma.lead.deleteMany({ where: { datasetId } }),
    ...(propertyIds.length ? [prisma.property.deleteMany({ where: { id: { in: propertyIds } } })] : []),
    ...(leadIds.length ? [prisma.lead.deleteMany({ where: { id: { in: leadIds } } })] : []),
    prisma.dataSet.deleteMany({ where: { id: datasetId } }),
  ]);
  return bumpRev();
}

// ---------- single-entity writes ----------

export async function insertCall(j: Record<string, any>): Promise<string> {
  const data = callWriteData(j);
  await prisma.callLog.upsert({ where: { id: j.id }, create: { id: j.id, ...data }, update: data });
  return bumpRev();
}

export async function upsertRequest(j: Record<string, any>): Promise<string> {
  const data = requestWriteData(j);
  await prisma.batchRequest.upsert({ where: { id: j.id }, create: { id: j.id, ...data }, update: data });
  return bumpRev();
}

export async function upsertSettings(j: Record<string, any>): Promise<string> {
  const data = settingsWriteData(j);
  await prisma.settings.upsert({
    where: { id: config.orgId },
    create: { id: config.orgId, ...data },
    update: data,
  });
  return bumpRev();
}

export async function insertAudit(j: Record<string, any>) {
  const data = auditWriteData(j);
  await prisma.auditEntry.upsert({ where: { id: j.id }, create: { id: j.id, ...data }, update: data });
  // Audit is high-volume and the frontend does not bump its sync rev for audit
  // writes either — so we intentionally skip bumpRev() here to match behaviour.
}
