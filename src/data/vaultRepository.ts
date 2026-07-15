import { DataSet, Property, Lead, CallLog, BatchRequest, VaultSettings, AuditEntry, kOrgId } from '../types/models';
import { AppUser, demoUsers } from '../types/user';
import { vaultDb } from './vaultDb';
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
  saveUser(user: AppUser): Promise<void>;
  deleteUser(userId: string): Promise<void>;
  onExternalChange(handler: () => void): void;
}

class LocalVaultRepository implements VaultRepository {
  private static _revKey = 'prospector.vault.rev.v1';
  private _sync = getTabSync();

  async load(): Promise<VaultSnapshot> {
    const rawSets = await vaultDb.getAll('datasets');
    const rawProps = await vaultDb.getAll('properties');
    const rawLeads = await vaultDb.getAll('leads');
    const rawCalls = await vaultDb.getAll('calls');
    const rawRequests = await vaultDb.getAll('requests');
    const rawSettings = await vaultDb.getAll('settings');
    const rawAudit = await vaultDb.getAll('audit');
    let users = (await vaultDb.getAll('users')).map(u => AppUser.fromJson(u));
    if (users.length === 0) {
      for (const u of demoUsers) {
        await vaultDb.putAll('users', { [u.id]: u.toJson() as Record<string, unknown> });
      }
      users = [...demoUsers];
    }

    return new VaultSnapshot(
      rawSets.map(d => DataSet.fromJson(d)).sort((a, b) => b.importedAt.localeCompare(a.importedAt)),
      rawProps.map(p => Property.fromJson(p)),
      rawLeads.map(l => Lead.fromJson(l)),
      rawCalls.map(c => CallLog.fromJson(c)).sort((a, b) => b.at.localeCompare(a.at)),
      rawRequests.map(r => BatchRequest.fromJson(r)).sort((a, b) => b.at.localeCompare(a.at)),
      rawSettings.length > 0 ? VaultSettings.fromJson(rawSettings[0]) : new VaultSettings(),
      rawAudit.map(a => AuditEntry.fromJson(a)).sort((a, b) => b.at.localeCompare(a.at)),
      users.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())),
    );
  }

  async commitImport(dataset: DataSet, properties: Property[], onProgress?: (done: number, total: number) => void): Promise<void> {
    await vaultDb.putAll('datasets', { [dataset.id]: dataset.toJson() as Record<string, unknown> });
    const props: Record<string, Record<string, unknown>> = {};
    for (const p of properties) props[p.id] = p.toJson() as Record<string, unknown>;
    await vaultDb.putAll('properties', props, onProgress);
    this._bump();
  }

  async commitLeadImport(dataset: DataSet, leads: Lead[], onProgress?: (done: number, total: number) => void): Promise<void> {
    await vaultDb.putAll('datasets', { [dataset.id]: dataset.toJson() as Record<string, unknown> });
    const ls: Record<string, Record<string, unknown>> = {};
    for (const l of leads) ls[l.id] = l.toJson() as Record<string, unknown>;
    await vaultDb.putAll('leads', ls, onProgress);
    this._bump();
  }

  async saveProperties(properties: Property[]): Promise<void> {
    if (properties.length === 0) return;
    const props: Record<string, Record<string, unknown>> = {};
    for (const p of properties) props[p.id] = p.toJson() as Record<string, unknown>;
    await vaultDb.putAll('properties', props);
    this._bump();
  }

  async saveLeads(leads: Lead[]): Promise<void> {
    if (leads.length === 0) return;
    const ls: Record<string, Record<string, unknown>> = {};
    for (const l of leads) ls[l.id] = l.toJson() as Record<string, unknown>;
    await vaultDb.putAll('leads', ls);
    this._bump();
  }

  async saveCall(call: CallLog): Promise<void> {
    await vaultDb.putAll('calls', { [call.id]: call.toJson() as Record<string, unknown> });
    this._bump();
  }

  async saveRequest(request: BatchRequest): Promise<void> {
    await vaultDb.putAll('requests', { [request.id]: request.toJson() as Record<string, unknown> });
    this._bump();
  }

  async saveSettings(settings: VaultSettings): Promise<void> {
    await vaultDb.putAll('settings', { [kOrgId]: settings.toJson() as Record<string, unknown> });
    this._bump();
  }

  async saveAudit(entry: AuditEntry): Promise<void> {
    await vaultDb.putAll('audit', { [entry.id]: entry.toJson() as Record<string, unknown> });
  }

  async deleteDataset(datasetId: string, propertyIds: string[], leadIds: string[] = []): Promise<void> {
    await vaultDb.deleteAll('properties', propertyIds);
    if (leadIds.length > 0) await vaultDb.deleteAll('leads', leadIds);
    await vaultDb.deleteAll('datasets', [datasetId]);
    this._bump();
  }

  async saveUser(user: AppUser): Promise<void> {
    await vaultDb.putAll('users', { [user.id]: user.toJson() as Record<string, unknown> });
    this._bump();
  }

  async deleteUser(userId: string): Promise<void> {
    await vaultDb.deleteAll('users', [userId]);
    this._bump();
  }

  private _bump(): void {
    this._sync.write(LocalVaultRepository._revKey, Date.now().toString());
  }

  onExternalChange(handler: () => void): void {
    this._sync.onExternalChange(LocalVaultRepository._revKey, () => handler());
  }
}

export const vaultRepo = new LocalVaultRepository();
