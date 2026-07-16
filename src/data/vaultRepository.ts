import { DataSet, Property, Lead, CallLog, BatchRequest, VaultSettings, AuditEntry, RequestStatus } from '../types/models';
import { AppUser } from '../types/user';
import { api } from './apiClient';
import { getTabSync } from './tabSync';

export class VaultSnapshot {
  constructor(
    public datasets: DataSet[],
    public properties: Property[],
    public leads: Lead[],
    public calls: CallLog[],
    public requests: BatchRequest[],
    public settings: VaultSettings,
    public audit: AuditEntry[],
    public users: AppUser[],
  ) {}
}

export interface SaveUserOptions {
  create?: boolean;
  password?: string;
}

export interface VaultRepository {
  load(): Promise<VaultSnapshot>;
  commitImport(dataset: DataSet, properties: Property[], onProgress?: (done: number, total: number) => void): Promise<void>;
  commitLeadImport(dataset: DataSet, leads: Lead[], onProgress?: (done: number, total: number) => void): Promise<void>;
  saveProperties(properties: Property[]): Promise<void>;
  saveLeads(leads: Lead[]): Promise<void>;
  saveCall(call: CallLog): Promise<void>;
  saveRequest(request: BatchRequest): Promise<void>;
  saveSettings(settings: VaultSettings): Promise<void>;
  saveAudit(entry: AuditEntry): Promise<void>;
  deleteDataset(datasetId: string, propertyIds: string[], leadIds?: string[]): Promise<void>;
  saveUser(user: AppUser, opts?: SaveUserOptions): Promise<void>;
  deleteUser(userId: string): Promise<void>;
  onExternalChange(handler: () => void): () => void;
}

interface RevResponse { rev?: string }

interface SnapshotDto {
  datasets: Record<string, unknown>[];
  properties: Record<string, unknown>[];
  leads: Record<string, unknown>[];
  calls: Record<string, unknown>[];
  requests: Record<string, unknown>[];
  settings: Record<string, unknown>;
  audit: Record<string, unknown>[];
  users: Record<string, unknown>[];
  rev: string;
}

/**
 * Backend-backed implementation of the exact same repository contract the app
 * used against IndexedDB. Every screen keeps talking to VaultContext, which
 * talks to this — so nothing above this layer changes.
 */
class ApiVaultRepository implements VaultRepository {
  private static _revKey = 'prospector.vault.rev.v1';
  private _sync = getTabSync();
  private _lastRev = '';
  private _pollTimer: ReturnType<typeof setInterval> | null = null;

  async load(): Promise<VaultSnapshot> {
    const d = await api.get<SnapshotDto>('/vault');
    this._lastRev = d.rev;

    // Ordering mirrors the original LocalVaultRepository.load() precisely.
    return new VaultSnapshot(
      d.datasets.map(x => DataSet.fromJson(x)).sort((a, b) => b.importedAt.localeCompare(a.importedAt)),
      d.properties.map(x => Property.fromJson(x)),
      d.leads.map(x => Lead.fromJson(x)),
      d.calls.map(x => CallLog.fromJson(x)).sort((a, b) => b.at.localeCompare(a.at)),
      d.requests.map(x => BatchRequest.fromJson(x)).sort((a, b) => b.at.localeCompare(a.at)),
      d.settings ? VaultSettings.fromJson(d.settings) : new VaultSettings(),
      d.audit.map(x => AuditEntry.fromJson(x)).sort((a, b) => b.at.localeCompare(a.at)),
      d.users.map(x => AppUser.fromJson(x)).sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())),
    );
  }

  async commitImport(dataset: DataSet, properties: Property[], onProgress?: (done: number, total: number) => void): Promise<void> {
    const res = await api.post<RevResponse>('/imports/properties', {
      dataset: dataset.toJson(),
      properties: properties.map(p => p.toJson()),
    });
    onProgress?.(properties.length, properties.length);
    this._applyRev(res);
  }

  async commitLeadImport(dataset: DataSet, leads: Lead[], onProgress?: (done: number, total: number) => void): Promise<void> {
    const res = await api.post<RevResponse>('/imports/leads', {
      dataset: dataset.toJson(),
      leads: leads.map(l => l.toJson()),
    });
    onProgress?.(leads.length, leads.length);
    this._applyRev(res);
  }

  async saveProperties(properties: Property[]): Promise<void> {
    if (properties.length === 0) return;
    const res = await api.put<RevResponse>('/properties', { properties: properties.map(p => p.toJson()) });
    this._applyRev(res);
  }

  async saveLeads(leads: Lead[]): Promise<void> {
    if (leads.length === 0) return;
    const res = await api.put<RevResponse>('/leads', { leads: leads.map(l => l.toJson()) });
    this._applyRev(res);
  }

  async saveCall(call: CallLog): Promise<void> {
    const res = await api.post<RevResponse>('/calls', call.toJson());
    this._applyRev(res);
  }

  async saveRequest(request: BatchRequest): Promise<void> {
    // A freshly submitted request creates; a decided one updates. This keeps
    // the correct permission boundary (requestData vs assignData) server-side.
    const isNew = request.status === RequestStatus.pending && request.decidedAt == null;
    const res = isNew
      ? await api.post<RevResponse>('/requests', request.toJson())
      : await api.put<RevResponse>(`/requests/${encodeURIComponent(request.id)}`, request.toJson());
    this._applyRev(res);
  }

  async saveSettings(settings: VaultSettings): Promise<void> {
    const res = await api.put<RevResponse>('/settings', settings.toJson());
    this._applyRev(res);
  }

  async saveAudit(entry: AuditEntry): Promise<void> {
    // Matches the original: audit writes do not bump the cross-tab sync rev.
    await api.post('/audit', entry.toJson());
  }

  async deleteDataset(datasetId: string, propertyIds: string[], leadIds: string[] = []): Promise<void> {
    const res = await api.del<RevResponse>(`/datasets/${encodeURIComponent(datasetId)}`, { propertyIds, leadIds });
    this._applyRev(res);
  }

  async saveUser(user: AppUser, opts?: SaveUserOptions): Promise<void> {
    const body: Record<string, unknown> = { ...user.toJson() };
    if (opts?.password) body.password = opts.password;
    const res = opts?.create
      ? await api.post<RevResponse>('/users', body)
      : await api.put<RevResponse>(`/users/${encodeURIComponent(user.id)}`, body);
    this._applyRev(res);
  }

  async deleteUser(userId: string): Promise<void> {
    const res = await api.del<RevResponse>(`/users/${encodeURIComponent(userId)}`);
    this._applyRev(res);
  }

  // Record the authoritative rev returned by our own write so the poller does
  // not treat it as an external change, then signal same-browser tabs.
  private _applyRev(res: RevResponse | undefined): void {
    if (res && res.rev) this._lastRev = res.rev;
    this._bump();
  }

  // Signal same-browser tabs immediately, and let cross-device changes be
  // picked up by the revision poller.
  private _bump(): void {
    this._sync.write(ApiVaultRepository._revKey, Date.now().toString());
  }

  onExternalChange(handler: () => void): () => void {
    // Same-browser cross-tab: instant via localStorage storage event.
    const unsubscribeSync = this._sync.onExternalChange(ApiVaultRepository._revKey, () => handler());

    // Cross-device: poll the server revision; reload when it moves.
    if (this._pollTimer) clearInterval(this._pollTimer);
    this._pollTimer = setInterval(async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const { rev } = await api.get<{ rev: string }>('/vault/rev');
        if (this._lastRev && rev !== this._lastRev) {
          this._lastRev = rev;
          handler();
        } else {
          this._lastRev = rev;
        }
      } catch {
        // transient network/auth blips are ignored; next tick retries
      }
    }, 8000);

    return () => {
      unsubscribeSync();
      if (this._pollTimer) {
        clearInterval(this._pollTimer);
        this._pollTimer = null;
      }
    };
  }
}

export const vaultRepo: VaultRepository = new ApiVaultRepository();
