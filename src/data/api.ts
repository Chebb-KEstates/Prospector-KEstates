import { get, post, patch, del, upload, tzOffsetMinutes, setCsrfToken } from './apiClient';
import {
  Property, Lead, CallLog, BatchRequest, DataSet, AuditEntry, VaultSettings,
  PropertyState, CallOutcome, DataSetType, DataModule, RequestStatus,
} from '../types/models';
import type { PhoneEntry } from '../types/models';
import { AppUser, UserRole, Permission } from '../types/user';
import { ColumnSpec } from '../logic/importModels';
import { LeadColumnSpec } from '../logic/leadPipeline';

/**
 * Typed endpoints.
 *
 * Wire JSON is rebuilt into the same domain classes the app has always used
 * (`Property.fromJson` etc.), so components keep their getters — `p.callable`,
 * `p.unitLabel`, `l.leadKey` — and nothing downstream knows the data crossed a
 * network.
 *
 * One thing to hold in mind: `owner.phone` on anything from a list endpoint is
 * the MASK ("••••••1234"), not a number. It is deliberately still a non-empty
 * string when a number exists, so `Property.callable` keeps returning the right
 * answer. To get a real number you call `properties.reveal()` — there is no
 * other route, by design.
 */

// ── Auth ───────────────────────────────────────────────────────────────────

/** The wire shape of a user — mirrors the server's `publicUser()`. */
export interface UserPayload {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  team: string;
  permissions: Permission[];
  viewCapOverride?: number;
  createdAt?: string;
}

export interface SessionResponse {
  user: UserPayload | null;
  mustChangePassword: boolean;
  csrfToken: string | null;
}

function toUser(j: UserPayload): AppUser {
  return new AppUser(
    j.id, j.name, j.email, j.role, j.active, j.team,
    j.permissions ? new Set(j.permissions) : undefined,
    j.viewCapOverride, j.createdAt,
  );
}

export const auth = {
  async session(): Promise<{ user: AppUser | null; mustChangePassword: boolean }> {
    const r = await get<SessionResponse>('/api/auth/session');
    setCsrfToken(r.csrfToken);
    return { user: r.user ? toUser(r.user) : null, mustChangePassword: r.mustChangePassword };
  },

  async login(email: string, password: string): Promise<{ user: AppUser; mustChangePassword: boolean }> {
    const r = await post<SessionResponse>('/api/auth/login', { email, password });
    setCsrfToken(r.csrfToken);
    return { user: toUser(r.user!), mustChangePassword: r.mustChangePassword };
  },

  async logout(): Promise<{ ok: true }> {
    const r = await post<{ ok: true }>('/api/auth/logout');
    setCsrfToken(null);
    return r;
  },

  async changePassword(currentPassword: string, newPassword: string): Promise<{ ok: true }> {
    const r = await post<{ ok: true; csrfToken: string }>(
      '/api/auth/change-password', { currentPassword, newPassword },
    );
    setCsrfToken(r.csrfToken);
    return r;
  },
};

// ── Users ──────────────────────────────────────────────────────────────────

export const users = {
  async list(): Promise<AppUser[]> {
    const rows = await get<UserPayload[]>('/api/users');
    return rows.map(toUser);
  },

  async create(input: {
    name: string; email: string; role: UserRole; team?: string; active?: boolean;
    permissions?: Permission[]; viewCapOverride?: number; initialPassword: string;
  }): Promise<AppUser> {
    return toUser(await post('/api/users', input));
  },

  async update(id: string, input: {
    name?: string; email?: string; role?: UserRole; team?: string; active?: boolean;
    permissions?: Permission[]; viewCapOverride?: number | null;
  }): Promise<AppUser> {
    return toUser(await patch(`/api/users/${id}`, input));
  },

  resetPassword: (id: string, newPassword: string) =>
    post<{ ok: true }>(`/api/users/${id}/password`, { newPassword }),
};

// ── Properties ─────────────────────────────────────────────────────────────

export interface PropertyQuery {
  search?: string; community?: string; cluster?: string;
  state?: PropertyState | ''; beds?: number; nationality?: string;
  outcome?: string; txFrom?: string; txTo?: string; callableOnly?: boolean;
  /** Follow-up due now or overdue — the broker's "Due follow-up" chip. */
  dueOnly?: boolean;
  /** Last outcome was interested (sell or rent) — the "Interested" chip. */
  interestedOnly?: boolean;
  /** Held units within the assignment-timer "expiring soon" window. */
  expiringSoon?: boolean;
  /** Tenancy signal filter. */
  tenancy?: 'vacant' | 'rented' | 'leaseSoon';
  assignedTo?: string; datasetId?: string;
  scope?: 'all' | 'mine' | 'pool';
  sortKey?: string; asc?: boolean; page?: number; pageSize?: number;
}

export interface Page<T> { rows: T[]; total: number; page: number; pageSize: number; }

export interface PropertyFacets {
  communities: string[]; clusters: string[]; states: PropertyState[];
  beds: number[]; nationalities: string[]; outcomes: CallOutcome[]; extraKeys: string[];
}

/**
 * `phone` is the primary; `phones` is EVERY number on record, labelled
 * (Mobile 1 / Mobile 2 / …). Both grouped for display. Mirrors the server's
 * RevealResult — one reveal returns the owner's whole contact card, and costs
 * one cap decrement.
 */
export interface RevealResult {
  phone: string;
  phones: PhoneEntry[];
  /** Per co-owner, each with their own real number(s). Present only for a
   *  multi-owner unit; one reveal returns the whole card. */
  owners?: { name: string; phones: PhoneEntry[] }[];
  used: number;
  cap: number;
}

/** One entry in a unit's history journal — a call, a record event, or its import. */
export type PropertyEvent =
  | { kind: 'call'; at: string; outcome: CallOutcome; note?: string; actorId?: string; ownerName?: string; unitLabel?: string; thisUnit?: boolean }
  | { kind: 'audit'; at: string; action: string; detail: string; actorId?: string }
  | { kind: 'import'; at: string; detail: string };

export const properties = {
  async page(q: PropertyQuery, signal?: AbortSignal): Promise<Page<Property>> {
    const r = await get<Page<Record<string, unknown>>>('/api/properties', q as Record<string, unknown>, signal);
    return { ...r, rows: r.rows.map(Property.fromJson) };
  },

  facets: (q: PropertyQuery, signal?: AbortSignal) =>
    get<PropertyFacets>('/api/properties/facets', q as Record<string, unknown>, signal),

  async byId(id: string): Promise<Property> {
    return Property.fromJson(await get<Record<string, unknown>>(`/api/properties/${id}`));
  },

  async mine(): Promise<Property[]> {
    const rows = await get<Record<string, unknown>[]>('/api/properties/mine');
    return rows.map(Property.fromJson);
  },

  /** Every unit belonging to this unit's owner — the dialer's grouped card. */
  async ownerUnits(id: string): Promise<Property[]> {
    const rows = await get<Record<string, unknown>[]>(`/api/properties/${id}/owner-units`);
    return rows.map(Property.fromJson);
  },

  async calls(id: string): Promise<CallLog[]> {
    const rows = await get<Record<string, unknown>[]>(`/api/properties/${id}/calls`);
    return rows.map(CallLog.fromJson);
  },

  /** The record's full history journal — calls + key events, newest first. */
  async events(id: string): Promise<PropertyEvent[]> {
    return get<PropertyEvent[]>(`/api/properties/${id}/events`);
  },

  /** The sanctioned reveal: single record, capped, audited. */
  reveal: (id: string, enforceCap = false) =>
    post<RevealResult>(`/api/properties/${id}/reveal`, {
      enforceCap, tzOffsetMinutes: tzOffsetMinutes(),
    }),

  /** An audited, cap-counted view that returns no number. */
  recordView: (id: string, what: string) =>
    post<{ used: number; cap: number }>(`/api/properties/${id}/view`, {
      what, tzOffsetMinutes: tzOffsetMinutes(),
    }),

  assign: (propertyIds: string[], brokerId: string, note?: string) =>
    post<{ assigned: number; ownerLinkedExtra: number }>('/api/properties/assign', {
      propertyIds, brokerId, note,
    }),

  reclaim: (propertyIds: string[]) =>
    post<{ reclaimed: number }>('/api/properties/reclaim', { propertyIds }),

  async undoDnc(id: string): Promise<Property> {
    return Property.fromJson(await post(`/api/properties/${id}/undo-dnc`));
  },

  async saveNotes(id: string, notes: string): Promise<Property> {
    return Property.fromJson(await patch(`/api/properties/${id}/notes`, { notes }));
  },
};

// ── Leads ──────────────────────────────────────────────────────────────────

export interface LeadQuery {
  search?: string; state?: PropertyState | ''; project?: string; source?: string;
  outcome?: string; callableOnly?: boolean; assignedTo?: string; datasetId?: string;
  enquiryFrom?: string; enquiryTo?: string;
  scope?: 'all' | 'mine' | 'pool';
  sortKey?: string; asc?: boolean; page?: number; pageSize?: number;
}

export interface LeadFacets {
  states: PropertyState[]; projects: string[]; sources: string[];
  outcomes: CallOutcome[]; extraKeys: string[];
}

export const leads = {
  async page(q: LeadQuery, signal?: AbortSignal): Promise<Page<Lead>> {
    const r = await get<Page<Record<string, unknown>>>('/api/leads', q as Record<string, unknown>, signal);
    return { ...r, rows: r.rows.map(Lead.fromJson) };
  },

  facets: (q: LeadQuery, signal?: AbortSignal) =>
    get<LeadFacets>('/api/leads/facets', q as Record<string, unknown>, signal),

  async byId(id: string): Promise<Lead> {
    return Lead.fromJson(await get<Record<string, unknown>>(`/api/leads/${id}`));
  },

  async mine(): Promise<Lead[]> {
    const rows = await get<Record<string, unknown>[]>('/api/leads/mine');
    return rows.map(Lead.fromJson);
  },

  async calls(id: string): Promise<CallLog[]> {
    const rows = await get<Record<string, unknown>[]>(`/api/leads/${id}/calls`);
    return rows.map(CallLog.fromJson);
  },

  reveal: (id: string, enforceCap = false) =>
    post<RevealResult>(`/api/leads/${id}/reveal`, {
      enforceCap, tzOffsetMinutes: tzOffsetMinutes(),
    }),

  assign: (leadIds: string[], brokerId: string, note?: string) =>
    post<{ assigned: number }>('/api/leads/assign', { leadIds, brokerId, note }),

  reclaim: (leadIds: string[]) =>
    post<{ reclaimed: number }>('/api/leads/reclaim', { leadIds }),

  async undoDnc(id: string): Promise<Lead> {
    return Lead.fromJson(await post(`/api/leads/${id}/undo-dnc`));
  },
};

// ── Calls ──────────────────────────────────────────────────────────────────

export const calls = {
  async log(input: {
    propertyIds: string[]; outcome: CallOutcome; note?: string; followUpAt?: string; ownerName?: string;
  }): Promise<CallLog> {
    return CallLog.fromJson(await post('/api/calls', input));
  },

  async logLead(input: {
    leadId: string; outcome: CallOutcome; note?: string; followUpAt?: string;
  }): Promise<CallLog> {
    return CallLog.fromJson(await post('/api/calls/lead', input));
  },

  async list(q: { brokerId?: string; page?: number; pageSize?: number } = {}): Promise<CallLog[]> {
    const r = await get<{ rows: Record<string, unknown>[] }>('/api/calls', q);
    return r.rows.map(CallLog.fromJson);
  },
};

// ── Requests ───────────────────────────────────────────────────────────────

export const requests = {
  async list(q: { status?: RequestStatus; brokerId?: string } = {}): Promise<BatchRequest[]> {
    const rows = await get<Record<string, unknown>[]>('/api/requests', q);
    return rows.map(BatchRequest.fromJson);
  },

  async submit(input: {
    community: string; cluster?: string; count: number; unitIds?: string[]; note?: string;
  }): Promise<BatchRequest> {
    return BatchRequest.fromJson(await post('/api/requests', input));
  },

  pendingCount: () => get<{ count: number }>('/api/requests/pending-count'),

  async approve(id: string): Promise<{ granted: number; request: BatchRequest }> {
    const r = await post<{ granted: number; request: Record<string, unknown> }>(
      `/api/requests/${id}/approve`,
    );
    return { granted: r.granted, request: BatchRequest.fromJson(r.request) };
  },

  async deny(id: string): Promise<BatchRequest> {
    return BatchRequest.fromJson(await post(`/api/requests/${id}/deny`));
  },
};

// ── Data sets ──────────────────────────────────────────────────────────────

export const datasets = {
  async list(): Promise<DataSet[]> {
    const rows = await get<Record<string, unknown>[]>('/api/datasets');
    return rows.map(DataSet.fromJson);
  },

  remove: (id: string) =>
    del<{ deleted: true; removedUnits: number; removedLeads: number }>(`/api/datasets/${id}`),
};

// ── Settings ───────────────────────────────────────────────────────────────

export const settings = {
  async load(): Promise<VaultSettings> {
    return VaultSettings.fromJson(await get<Record<string, unknown>>('/api/settings'));
  },

  async save(s: VaultSettings): Promise<VaultSettings> {
    return VaultSettings.fromJson(await patch('/api/settings', s.toJson()));
  },
};

// ── Audit ──────────────────────────────────────────────────────────────────

export const audit = {
  async list(q: { actorId?: string; action?: string; page?: number; pageSize?: number } = {}) {
    const r = await get<{ rows: Record<string, unknown>[]; total: number }>('/api/audit', q);
    return { rows: r.rows.map(AuditEntry.fromJson), total: r.total };
  },
};

// ── Dashboards ─────────────────────────────────────────────────────────────

export interface ManagerDashboard {
  properties: {
    total: number; callable: number; owners: number;
    byState: Record<PropertyState, number>;
  };
  leads: { total: number; byState: Record<PropertyState, number> };
  datasets: { id: string; name: string; callableUnits: number; worked: number }[];
  /** The caller's local day. */
  today: {
    calls: number; reached: number; interested: number;
    outcomes: Record<string, number>;
  };
  rolling: {
    days: number; calls: number; reached: number; interested: number;
    momentum: { day: string; n: number }[];
  };
  alerts: {
    pendingRequests: number;
    idleBrokers: string[];
    staleCount: number;
    /** Held units whose assignment timer is nearly up. */
    expiringSoon: number;
  };
  communities: string[];
  board: {
    id: string; name: string; team: string; onList: number;
    callsToday: number; reachedToday: number; interestedToday: number;
    lastAt?: string; quiet: boolean;
  }[];
  recentAudit: Record<string, unknown>[];
}

export interface BrokerDashboard {
  myCalls: number;
  myInterested: number;
  myLastAt?: string;
  myCallsToday: number;
  myReachedToday: number;
  myInterestedToday: number;
  myOnList: number;
  /** My held units whose assignment timer is nearly up. */
  myExpiringSoon: number;
  teamAverageCalls: number;
  poolAvailable: number;
  myPendingRequests: number;
  byState: Record<PropertyState, number>;
}

export interface TeamBrokerRow {
  id: string; name: string; team: string;
  assigned: number; portfolio: number;
  calls: number; calls7d: number; calls24h: number;
  reached: number; interested: number; noAnswer: number;
  lastAt?: string;
}

export interface TeamDatasetRow {
  id: string; name: string; module: DataModule;
  properties: number; callable: number; numbers: number;
  agents: number; assigned: number; untouched: number;
  calls: number; noAnswer: number; interested: number;
  cost?: number;
  importedAt: string; lastUpdatedAt?: string;
}

export interface TeamDashboard {
  brokers: TeamBrokerRow[];
  datasetStats: TeamDatasetRow[];
  roi: {
    totalCost: number;
    datasets: number;
    properties: number;
    callable: number;
    callableWorked: number;
    calls: number;
    reached: number;
    interested: number;
    costPerInterested?: number;
  };
}

export const dashboard = {
  manager: (days = 14) =>
    get<ManagerDashboard>('/api/dashboard/manager', { days, tzOffsetMinutes: tzOffsetMinutes() }),
  broker: () =>
    get<BrokerDashboard>('/api/dashboard/broker', { tzOffsetMinutes: tzOffsetMinutes() }),
  team: () => get<TeamDashboard>('/api/dashboard/team'),
};

// ── Imports ────────────────────────────────────────────────────────────────

export interface StagedImport {
  sessionId: string;
  fileName: string;
  sheets: { name: string; rowCount: number }[];
  headerRow: number;
  columns: ColumnSpec[] | LeadColumnSpec[];
  detectedType?: DataSetType;
  preview: unknown[][];
}

/** What an update changes across the matched units — for the review step. */
export interface ImportChangeTally {
  ownerChanges: number; ownerCountChanges: number; phoneChanges: number;
  rentalChanges: number; saleChanges: number; physicalChanges: number;
}

export interface OwnerDryRun {
  type: DataSetType;
  sourceRows: number; invalidRows: number; inFileDuplicates: number;
  newCount: number; updatedCount: number; uniqueUnits: number; callable: number;
  changes: ImportChangeTally;
  sample: { owner: string; community: string; unit: string; phone: string }[];
}

export interface LeadDryRunSummary {
  sourceRows: number; invalidRows: number; inFileDuplicates: number;
  newCount: number; updatedCount: number; uniqueLeads: number; callable: number;
}

export const imports = {
  /** Upload + stage. The server parses and discards the bytes. */
  stage: (file: File, module: DataModule) =>
    upload<StagedImport>('/api/imports', file, { module }),

  columns: (sessionId: string, headerRow: number, sheetIndex = 0) =>
    post<{ columns: ColumnSpec[] | LeadColumnSpec[]; detectedType?: DataSetType }>(
      `/api/imports/${sessionId}/columns`, { headerRow, sheetIndex },
    ),

  dryRunOwners: (sessionId: string, body: {
    sheetIndex?: number; headerRow: number; columns: ColumnSpec[];
    type: DataSetType; communityFallback: string;
    /** Update an existing set instead of creating a new one. */
    targetDatasetId?: string;
    /** Owner reconciliation for matched units (update mode). */
    ownerMode?: 'replace' | 'patch';
  }) => post<OwnerDryRun>(`/api/imports/${sessionId}/dry-run`, body),

  dryRunLeads: (sessionId: string, body: {
    sheetIndex?: number; headerRow: number; columns: LeadColumnSpec[];
  }) => post<LeadDryRunSummary>(`/api/imports/${sessionId}/dry-run`, body),

  commitOwners: (sessionId: string, body: {
    sheetIndex?: number; headerRow: number; columns: ColumnSpec[];
    type: DataSetType; communityFallback: string;
    datasetName?: string; source?: string; cost?: number;
    /** Update an existing set instead of creating a new one. */
    targetDatasetId?: string;
    /** Owner reconciliation for matched units (update mode). */
    ownerMode?: 'replace' | 'patch';
  }) => post<{ datasetId: string; imported: number }>(`/api/imports/${sessionId}/commit`, body),

  commitLeads: (sessionId: string, body: {
    sheetIndex?: number; headerRow: number; columns: LeadColumnSpec[];
    datasetName: string; source?: string; cost?: number;
  }) => post<{ datasetId: string; imported: number }>(`/api/imports/${sessionId}/commit`, body),
};
