/**
 * Bidirectional mappers between Prisma rows and the exact JSON shapes the
 * frontend's `*.toJson()` / `*.fromJson()` use. Keeping these byte-compatible
 * is what lets the existing React models consume API responses unchanged.
 */
import type {
  User, DataSet, Property, Lead, CallLog, BatchRequest, AuditEntry, Settings,
} from '@prisma/client';
import { defaultPermissions } from './constants';

// Undefined-or-value → value-or-null (for nullable Prisma columns).
const n = <T>(v: T | undefined | null): T | null => (v === undefined ? null : v);

// ---------- User ----------

export function userToJson(u: User): Record<string, unknown> {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    active: u.active,
    team: u.team,
    permissions: (u.permissions as string[] | null) ?? defaultPermissions(u.role),
    viewCapOverride: u.viewCapOverride ?? undefined,
    createdAt: u.createdAt ?? undefined,
  };
}

export interface UserPayload {
  id: string;
  name?: string;
  email?: string;
  role?: string;
  active?: boolean;
  team?: string;
  permissions?: string[] | null;
  viewCapOverride?: number | null;
  createdAt?: string;
}

export function userWriteData(p: UserPayload) {
  return {
    name: p.name ?? '',
    email: p.email ?? '',
    role: p.role ?? 'broker',
    active: p.active ?? true,
    team: p.team ?? '',
    permissions: p.permissions && p.permissions.length > 0 ? p.permissions : undefined,
    viewCapOverride: n(p.viewCapOverride),
    createdAt: n(p.createdAt),
  };
}

// ---------- DataSet ----------

export function datasetToJson(d: DataSet): Record<string, unknown> {
  return {
    id: d.id, name: d.name, source: d.source, type: d.type, module: d.module,
    fileName: d.fileName, communityLabel: d.communityLabel, importedAt: d.importedAt,
    cost: d.cost ?? undefined, totalUnits: d.totalUnits,
    callableUnits: d.callableUnits, updatedUnits: d.updatedUnits,
  };
}

export function datasetWriteData(j: Record<string, any>) {
  return {
    name: j.name ?? '', source: j.source ?? '', type: j.type ?? 'register',
    module: j.module ?? 'owners', fileName: j.fileName ?? '',
    communityLabel: j.communityLabel ?? '',
    importedAt: j.importedAt ?? new Date().toISOString(),
    cost: n(j.cost), totalUnits: j.totalUnits ?? 0,
    callableUnits: j.callableUnits ?? 0, updatedUnits: j.updatedUnits ?? 0,
  };
}

// ---------- Property ----------

export function propertyToJson(p: Property): Record<string, unknown> {
  return {
    id: p.id, orgId: p.orgId, datasetId: p.datasetId, state: p.state,
    unitKey: p.unitKey, community: p.community, cluster: p.cluster ?? undefined,
    building: p.building ?? undefined, unitNumber: p.unitNumber ?? undefined,
    plotNumber: p.plotNumber ?? undefined, propertyType: p.propertyType ?? undefined,
    beds: p.beds ?? undefined, sizeSqft: p.sizeSqft ?? undefined,
    plotSqft: p.plotSqft ?? undefined, lastTransactionDate: p.lastTransactionDate ?? undefined,
    lastTransactionValue: p.lastTransactionValue ?? undefined, txCount: p.txCount,
    rentStart: p.rentStart ?? undefined, rentEnd: p.rentEnd ?? undefined,
    rentAmount: p.rentAmount ?? undefined,
    owner: { name: p.ownerName, phone: p.ownerPhone ?? undefined, nationality: p.ownerNationality ?? undefined },
    createdAt: p.createdAt, updatedAt: p.updatedAt,
    assignedTo: p.assignedTo ?? undefined, assignedAt: p.assignedAt ?? undefined,
    assignmentNote: p.assignmentNote ?? undefined, cooldownUntil: p.cooldownUntil ?? undefined,
    portfolioSince: p.portfolioSince ?? undefined, lastOutcome: p.lastOutcome ?? undefined,
    lastCalledAt: p.lastCalledAt ?? undefined, callAttempts: p.callAttempts,
    nextFollowUpAt: p.nextFollowUpAt ?? undefined, dncAt: p.dncAt ?? undefined,
  };
}

export function propertyWriteData(j: Record<string, any>) {
  const owner = (j.owner ?? {}) as Record<string, any>;
  return {
    orgId: j.orgId ?? 'org-1', datasetId: j.datasetId ?? '',
    state: j.state ?? 'pool', unitKey: j.unitKey ?? '',
    community: j.community ?? '', cluster: n(j.cluster), building: n(j.building),
    unitNumber: n(j.unitNumber), plotNumber: n(j.plotNumber), propertyType: n(j.propertyType),
    beds: n(j.beds), sizeSqft: n(j.sizeSqft), plotSqft: n(j.plotSqft),
    lastTransactionDate: n(j.lastTransactionDate), lastTransactionValue: n(j.lastTransactionValue),
    txCount: j.txCount ?? 0, rentStart: n(j.rentStart), rentEnd: n(j.rentEnd),
    rentAmount: n(j.rentAmount),
    ownerName: owner.name ?? '', ownerPhone: n(owner.phone), ownerNationality: n(owner.nationality),
    createdAt: j.createdAt ?? new Date().toISOString(),
    updatedAt: j.updatedAt ?? j.createdAt ?? new Date().toISOString(),
    assignedTo: n(j.assignedTo), assignedAt: n(j.assignedAt), assignmentNote: n(j.assignmentNote),
    cooldownUntil: n(j.cooldownUntil), portfolioSince: n(j.portfolioSince),
    lastOutcome: n(j.lastOutcome), lastCalledAt: n(j.lastCalledAt),
    callAttempts: j.callAttempts ?? 0, nextFollowUpAt: n(j.nextFollowUpAt), dncAt: n(j.dncAt),
  };
}

// ---------- Lead ----------

export function leadToJson(l: Lead): Record<string, unknown> {
  return {
    id: l.id, orgId: l.orgId, datasetId: l.datasetId,
    enquiryDate: l.enquiryDate ?? undefined, name: l.name,
    phone: l.phone ?? undefined, email: l.email ?? undefined,
    project: l.project ?? undefined, source: l.source ?? undefined,
    extra: (l.extra as Record<string, string> | null) ?? {},
    createdAt: l.createdAt, state: l.state, updatedAt: l.updatedAt,
    assignedTo: l.assignedTo ?? undefined, assignedAt: l.assignedAt ?? undefined,
    assignmentNote: l.assignmentNote ?? undefined, cooldownUntil: l.cooldownUntil ?? undefined,
    portfolioSince: l.portfolioSince ?? undefined, lastOutcome: l.lastOutcome ?? undefined,
    lastCalledAt: l.lastCalledAt ?? undefined, callAttempts: l.callAttempts,
    nextFollowUpAt: l.nextFollowUpAt ?? undefined, dncAt: l.dncAt ?? undefined,
  };
}

export function leadWriteData(j: Record<string, any>) {
  return {
    orgId: j.orgId ?? 'org-1', datasetId: j.datasetId ?? '',
    enquiryDate: n(j.enquiryDate), name: j.name ?? '', phone: n(j.phone),
    email: n(j.email), project: n(j.project), source: n(j.source),
    extra: j.extra && typeof j.extra === 'object' ? j.extra : {},
    createdAt: j.createdAt ?? new Date().toISOString(),
    state: j.state ?? 'pool', updatedAt: j.updatedAt ?? new Date().toISOString(),
    assignedTo: n(j.assignedTo), assignedAt: n(j.assignedAt), assignmentNote: n(j.assignmentNote),
    cooldownUntil: n(j.cooldownUntil), portfolioSince: n(j.portfolioSince),
    lastOutcome: n(j.lastOutcome), lastCalledAt: n(j.lastCalledAt),
    callAttempts: j.callAttempts ?? 0, nextFollowUpAt: n(j.nextFollowUpAt), dncAt: n(j.dncAt),
  };
}

// ---------- CallLog ----------

export function callToJson(c: CallLog): Record<string, unknown> {
  return {
    id: c.id, orgId: c.orgId, propertyIds: (c.propertyIds as string[]) ?? [],
    leadIds: (c.leadIds as string[]) ?? [], brokerId: c.brokerId, at: c.at,
    outcome: c.outcome, note: c.note ?? undefined, followUpAt: c.followUpAt ?? undefined,
  };
}

export function callWriteData(j: Record<string, any>) {
  return {
    orgId: j.orgId ?? 'org-1',
    propertyIds: Array.isArray(j.propertyIds) ? j.propertyIds : [],
    leadIds: Array.isArray(j.leadIds) ? j.leadIds : [],
    brokerId: j.brokerId ?? '', at: j.at ?? new Date().toISOString(),
    outcome: j.outcome ?? 'noAnswer', note: n(j.note), followUpAt: n(j.followUpAt),
  };
}

// ---------- BatchRequest ----------

export function requestToJson(r: BatchRequest): Record<string, unknown> {
  return {
    id: r.id, orgId: r.orgId, brokerId: r.brokerId, community: r.community,
    cluster: r.cluster ?? undefined, count: r.count,
    unitIds: (r.unitIds as string[]) ?? [], note: r.note ?? undefined,
    at: r.at, status: r.status, decidedAt: r.decidedAt ?? undefined,
    grantedCount: r.grantedCount,
  };
}

export function requestWriteData(j: Record<string, any>) {
  return {
    orgId: j.orgId ?? 'org-1', brokerId: j.brokerId ?? '',
    community: j.community ?? '', cluster: n(j.cluster), count: j.count ?? 0,
    unitIds: Array.isArray(j.unitIds) ? j.unitIds : [], note: n(j.note),
    at: j.at ?? new Date().toISOString(), status: j.status ?? 'pending',
    decidedAt: n(j.decidedAt), grantedCount: j.grantedCount ?? 0,
  };
}

// ---------- AuditEntry ----------

export function auditToJson(a: AuditEntry): Record<string, unknown> {
  return {
    id: a.id, orgId: a.orgId, at: a.at, actorId: a.actorId,
    action: a.action, detail: a.detail, propertyIds: (a.propertyIds as string[]) ?? [],
  };
}

export function auditWriteData(j: Record<string, any>) {
  return {
    orgId: j.orgId ?? 'org-1', at: j.at ?? new Date().toISOString(),
    actorId: j.actorId ?? '', action: j.action ?? '', detail: j.detail ?? '',
    propertyIds: Array.isArray(j.propertyIds) ? j.propertyIds : [],
  };
}

// ---------- Settings ----------

export function settingsToJson(s: Settings): Record<string, unknown> {
  return {
    notInterestedCooldownDays: s.notInterestedCooldownDays,
    listedCooldownDays: s.listedCooldownDays,
    maxNoAnswerAttempts: s.maxNoAnswerAttempts,
    assignmentExpiryDays: s.assignmentExpiryDays,
    portfolioStaleDays: s.portfolioStaleDays,
    dailyViewCap: s.dailyViewCap,
    wifiLockEnabled: s.wifiLockEnabled,
    officeIp: s.officeIp,
  };
}

export function settingsWriteData(j: Record<string, any>) {
  const d = {
    notInterestedCooldownDays: 30, listedCooldownDays: 30, maxNoAnswerAttempts: 3,
    assignmentExpiryDays: 14, portfolioStaleDays: 21, dailyViewCap: 100,
  };
  const int = (v: any, fb: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : fb);
  return {
    notInterestedCooldownDays: int(j.notInterestedCooldownDays, d.notInterestedCooldownDays),
    listedCooldownDays: int(j.listedCooldownDays, d.listedCooldownDays),
    maxNoAnswerAttempts: int(j.maxNoAnswerAttempts, d.maxNoAnswerAttempts),
    assignmentExpiryDays: int(j.assignmentExpiryDays, d.assignmentExpiryDays),
    portfolioStaleDays: int(j.portfolioStaleDays, d.portfolioStaleDays),
    dailyViewCap: int(j.dailyViewCap, d.dailyViewCap),
    wifiLockEnabled: j.wifiLockEnabled === true,
    officeIp: typeof j.officeIp === 'string' ? j.officeIp : '',
  };
}
