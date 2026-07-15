import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import {
  DataSet, Property, Lead, CallLog, BatchRequest, VaultSettings,
  AuditEntry, RequestStatus, PropertyState, CallOutcome, kOrgId,
} from '../types/models';
import { AppUser, UserRole, demoUserById } from '../types/user';
import { vaultRepo, VaultSnapshot } from '../data/vaultRepository';
import { applyOutcome, sweepCooldowns } from '../logic/dispositions';
import { ownerKeyOf } from '../logic/ownerGrouping';

interface VaultContextValue {
  loading: boolean;
  datasets: DataSet[];
  properties: Property[];
  leads: Lead[];
  calls: CallLog[];
  requests: BatchRequest[];
  settings: VaultSettings;
  audit: AuditEntry[];
  users: AppUser[];

  userById: (id?: string) => AppUser | undefined;
  brokers: AppUser[];
  callable: number;
  countIn: (s: PropertyState) => number;
  byUnitKey: Map<string, Property>;
  communities: string[];
  assignedTo: (brokerId: string) => Property[];
  leadById: (id: string) => Lead | undefined;
  leadCountIn: (s: PropertyState) => number;
  byLeadKey: Map<string, Lead>;
  leadsOf: (brokerId: string) => Lead[];
  callsForLead: (leadId: string) => CallLog[];
  pendingRequests: BatchRequest[];
  callsFor: (propertyIds: string[]) => CallLog[];
  callsBy: (brokerId: string) => CallLog[];
  viewsToday: (brokerId: string, now: string) => number;

  saveUser: (user: AppUser, by: string, action: string) => Promise<void>;
  deleteUser: (user: AppUser, by: string) => Promise<void>;
  saveSettings: (s: VaultSettings, by: string) => Promise<void>;
  recordView: (viewerId: string, isManager: boolean, what: string, enforceCap?: boolean) => boolean;
  commitImport: (dataset: DataSet, properties: Property[], by: string, onProgress?: (done: number, total: number) => void) => Promise<void>;
  commitLeadImport: (dataset: DataSet, leads: Lead[], by: string, onProgress?: (done: number, total: number) => void) => Promise<void>;
  assign: (batch: Property[], brokerId: string, by: string, note?: string) => Promise<number>;
  reclaim: (batch: Property[], by: string) => Promise<void>;
  assignLeads: (batch: Lead[], brokerId: string, by: string, note?: string) => Promise<number>;
  reclaimLeads: (batch: Lead[], by: string) => Promise<void>;
  submitRequest: (brokerId: string, community: string, count: number, cluster?: string, unitIds?: string[], note?: string) => Promise<void>;
  approveRequest: (req: BatchRequest, by: string) => Promise<number>;
  denyRequest: (req: BatchRequest, by: string) => Promise<void>;
  deleteDataset: (d: DataSet, by: string) => Promise<void>;
  undoDnc: (p: Property, by: string) => Promise<void>;
  undoDncLead: (l: Lead, by: string) => Promise<void>;
  logCall: (properties: Property[], brokerId: string, outcome: CallOutcome, note?: string, followUpAt?: string) => Promise<void>;
  logLeadCall: (lead: Lead, brokerId: string, outcome: CallOutcome, note?: string, followUpAt?: string) => Promise<void>;
}

const VaultContext = createContext<VaultContextValue | null>(null);

function copyState(state: VaultSnapshot): VaultSnapshot {
  return new VaultSnapshot(
    [...state.datasets], [...state.properties], [...state.leads],
    [...state.calls], [...state.requests], state.settings,
    [...state.audit], [...state.users],
  );
}

export function VaultProvider({ children }: { children: React.ReactNode }) {
  const [snap, setSnap] = useState<VaultSnapshot>(() => new VaultSnapshot(
    [], [], [], [], [], new VaultSettings(), [], [],
  ));
  const [loading, setLoading] = useState(true);
  const auditSeq = useRef(0);

  const reload = useCallback(async () => {
    const s = await vaultRepo.load();
    const now = new Date().toISOString();
    const lapsed = sweepCooldowns(s.properties, now, s.settings);
    if (lapsed.length > 0) await vaultRepo.saveProperties(lapsed);
    const lapsedLeads = sweepCooldowns(s.leads, now, s.settings);
    if (lapsedLeads.length > 0) await vaultRepo.saveLeads(lapsedLeads);
    setSnap(s);
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
    vaultRepo.onExternalChange(() => reload());
  }, [reload]);

  const _audit = useCallback((actorId: string, action: string, detail: string, ids: string[] = []) => {
    const entry = new AuditEntry(
      `a-${Date.now()}-${auditSeq.current++}`,
      kOrgId, new Date().toISOString(), actorId, action, detail, ids,
    );
    vaultRepo.saveAudit(entry);
    setSnap(prev => copyState({ ...prev, audit: [entry, ...prev.audit] }));
  }, []);

  const userById = useCallback((id?: string) => {
    if (!id) return undefined;
    const found = snap.users.find(u => u.id === id);
    return found ?? demoUserById(id);
  }, [snap.users]);

  const brokers = snap.users.filter(u => u.role === UserRole.broker);
  const callable = snap.properties.filter(p => p.callable).length;
  const countIn = (s: PropertyState) => snap.properties.filter(p => p.state === s).length;
  const byUnitKey = new Map(snap.properties.map(p => [p.unitKey, p]));
  const communities = Array.from(new Set(snap.properties.map(p => p.community))).sort();
  const assignedTo = (brokerId: string) => snap.properties.filter(p =>
    p.assignedTo === brokerId && (p.state === PropertyState.assigned || p.state === PropertyState.portfolio));
  const leadById = (id: string) => snap.leads.find(l => l.id === id);
  const leadCountIn = (s: PropertyState) => snap.leads.filter(l => l.state === s).length;
  const byLeadKey = new Map(snap.leads.map(l => [l.leadKey, l]));
  const leadsOf = (brokerId: string) => snap.leads.filter(l => l.assignedTo === brokerId);
  const callsForLead = (leadId: string) => snap.calls.filter(c => c.leadIds.includes(leadId));
  const pendingRequests = snap.requests.filter(r => r.status === RequestStatus.pending);
  const callsFor = (propertyIds: string[]) => {
    const ids = new Set(propertyIds);
    return snap.calls.filter(c => c.propertyIds.some(id => ids.has(id)));
  };
  const callsBy = (brokerId: string) => snap.calls.filter(c => c.brokerId === brokerId);
  const viewsToday = (brokerId: string, now: string) => {
    const d = new Date(now);
    return snap.audit.filter(a =>
      a.action === 'view' && a.actorId === brokerId &&
      new Date(a.at).getFullYear() === d.getFullYear() &&
      new Date(a.at).getMonth() === d.getMonth() &&
      new Date(a.at).getDate() === d.getDate()
    ).length;
  };

  const saveUser = useCallback(async (user: AppUser, by: string, action: string) => {
    await vaultRepo.saveUser(user);
    setSnap(prev => {
      const exists = prev.users.some(u => u.id === user.id);
      const next = exists
        ? prev.users.map(u => u.id === user.id ? user : u)
        : [...prev.users, user];
      next.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
      return copyState({ ...prev, users: next });
    });
    _audit(by, 'user', `${action} — ${user.name} (${user.role})`);
  }, [_audit]);

  const deleteUser = useCallback(async (user: AppUser, by: string) => {
    await vaultRepo.deleteUser(user.id);
    setSnap(prev => copyState({ ...prev, users: prev.users.filter(u => u.id !== user.id) }));
    _audit(by, 'user', `Removed account — ${user.name}`);
  }, [_audit]);

  const saveSettings = useCallback(async (s: VaultSettings, by: string) => {
    await vaultRepo.saveSettings(s);
    setSnap(prev => copyState({ ...prev, settings: s }));
    _audit(by, 'settings', 'Platform rules updated');
  }, [_audit]);

  const recordView = useCallback((viewerId: string, isManager: boolean, what: string, enforceCap = true): boolean => {
    const now = new Date().toISOString();
    const cap = userById(viewerId)?.viewCapOverride ?? snap.settings.dailyViewCap;
    if (enforceCap && !isManager && viewsToday(viewerId, now) >= cap) {
      _audit(viewerId, 'cap-block', `Daily view cap (${cap}) hit — ${what}`);
      return false;
    }
    _audit(viewerId, 'view', what);
    return true;
  }, [snap, _audit, viewsToday, userById]);

  const commitImport = useCallback(async (
    dataset: DataSet, properties: Property[], by: string,
    onProgress?: (done: number, total: number) => void,
  ) => {
    await vaultRepo.commitImport(dataset, properties, onProgress);
    setSnap(prev => {
      const merged = new Map(prev.properties.map(p => [p.id, p]));
      for (const p of properties) merged.set(p.id, p);
      return copyState({
        ...prev,
        datasets: [dataset, ...prev.datasets.filter(d => d.id !== dataset.id)],
        properties: Array.from(merged.values()),
      });
    });
    _audit(by, 'import', `Imported "${dataset.name}" — ${dataset.totalUnits} units`);
  }, [_audit]);

  const commitLeadImport = useCallback(async (
    dataset: DataSet, leads: Lead[], by: string,
    onProgress?: (done: number, total: number) => void,
  ) => {
    await vaultRepo.commitLeadImport(dataset, leads, onProgress);
    setSnap(prev => {
      const merged = new Map(prev.leads.map(l => [l.id, l]));
      for (const l of leads) merged.set(l.id, l);
      return copyState({
        ...prev,
        datasets: [dataset, ...prev.datasets.filter(d => d.id !== dataset.id)],
        leads: Array.from(merged.values()),
      });
    });
    _audit(by, 'import', `Imported leads "${dataset.name}" — ${dataset.totalUnits} enquiries`);
  }, [_audit]);

  const assign = useCallback(async (batch: Property[], brokerId: string, by: string, note?: string) => {
    const ids = new Set(batch.map(p => p.id));
    const ownerCommunity = new Set(batch.map(p => `${ownerKeyOf(p)}|${p.community}`));
    const expanded = [
      ...batch,
      ...snap.properties.filter(p =>
        !ids.has(p.id) && p.state === PropertyState.pool &&
        ownerCommunity.has(`${ownerKeyOf(p)}|${p.community}`)),
    ];
    const now = new Date().toISOString();
    for (const p of expanded) {
      p.state = PropertyState.assigned;
      p.assignedTo = brokerId;
      p.assignedAt = now;
      p.assignmentNote = note;
      p.callAttempts = 0;
      p.nextFollowUpAt = undefined;
      p.updatedAt = now;
    }
    await vaultRepo.saveProperties(expanded);
    setSnap(prev => copyState({ ...prev }));
    const extra = expanded.length - batch.length;
    _audit(by, 'assign',
      `Assigned to ${userById(brokerId)?.name ?? brokerId}` +
      (extra > 0 ? ` (incl. ${extra} owner-linked)` : ''),
      expanded.map(p => p.id));
    return expanded.length;
  }, [snap.properties, _audit, userById]);

  const reclaim = useCallback(async (batch: Property[], by: string) => {
    const now = new Date().toISOString();
    for (const p of batch) {
      p.state = PropertyState.pool;
      p.assignedAt = undefined;
      p.assignmentNote = undefined;
      p.nextFollowUpAt = undefined;
      p.portfolioSince = undefined;
      p.updatedAt = now;
    }
    await vaultRepo.saveProperties(batch);
    setSnap(prev => copyState({ ...prev }));
    _audit(by, 'reclaim', 'Reclaimed to the pool', batch.map(p => p.id));
  }, [_audit]);

  const assignLeads = useCallback(async (batch: Lead[], brokerId: string, by: string, note?: string) => {
    const now = new Date().toISOString();
    for (const l of batch) {
      l.state = PropertyState.assigned;
      l.assignedTo = brokerId;
      l.assignedAt = now;
      l.assignmentNote = note;
      l.callAttempts = 0;
      l.nextFollowUpAt = undefined;
      l.updatedAt = now;
    }
    await vaultRepo.saveLeads(batch);
    setSnap(prev => copyState({ ...prev }));
    _audit(by, 'assign',
      `Assigned ${batch.length} lead${batch.length === 1 ? '' : 's'} to ` +
      `${userById(brokerId)?.name ?? brokerId}`, batch.map(l => l.id));
    return batch.length;
  }, [_audit, userById]);

  const reclaimLeads = useCallback(async (batch: Lead[], by: string) => {
    const now = new Date().toISOString();
    for (const l of batch) {
      l.state = PropertyState.pool;
      l.assignedAt = undefined;
      l.assignmentNote = undefined;
      l.nextFollowUpAt = undefined;
      l.portfolioSince = undefined;
      l.updatedAt = now;
    }
    await vaultRepo.saveLeads(batch);
    setSnap(prev => copyState({ ...prev }));
    _audit(by, 'reclaim', 'Leads reclaimed to the pool', batch.map(l => l.id));
  }, [_audit]);

  const submitRequest = useCallback(async (
    brokerId: string, community: string, count: number,
    cluster?: string, unitIds: string[] = [], note?: string,
  ) => {
    const req = new BatchRequest(
      `rq-${Date.now()}`, kOrgId, brokerId, community, cluster,
      count, unitIds, note, new Date().toISOString(),
    );
    await vaultRepo.saveRequest(req);
    setSnap(prev => copyState({ ...prev, requests: [req, ...prev.requests] }));
    _audit(brokerId, 'request', `${req.summary} requested`);
  }, [_audit]);

  const approveRequest = useCallback(async (req: BatchRequest, by: string) => {
    let grant: Property[];
    if (req.isHandPicked) {
      const wanted = new Set(req.unitIds);
      grant = snap.properties.filter(p => wanted.has(p.id) && p.state === PropertyState.pool);
    } else {
      grant = snap.properties
        .filter(p => p.state === PropertyState.pool && p.community === req.community &&
          (req.cluster == null || p.cluster === req.cluster))
        .sort((a, b) => (b.callable ? 1 : 0) - (a.callable ? 1 : 0))
        .slice(0, req.count);
    }
    if (grant.length > 0) {
      await assign(grant, req.brokerId, by, 'Requested batch');
    }
    const decided = req.decided(RequestStatus.approved, grant.length);
    await vaultRepo.saveRequest(decided);
    setSnap(prev => copyState({
      ...prev,
      requests: prev.requests.map(r => r.id === req.id ? decided : r),
    }));
    _audit(by, 'approve', `Request ${req.id}: granted ${grant.length} of ${req.count}`);
    return grant.length;
  }, [snap.properties, _audit, assign]);

  const denyRequest = useCallback(async (req: BatchRequest, by: string) => {
    const decided = req.decided(RequestStatus.denied);
    await vaultRepo.saveRequest(decided);
    setSnap(prev => copyState({
      ...prev,
      requests: prev.requests.map(r => r.id === req.id ? decided : r),
    }));
    _audit(by, 'deny', `Request ${req.id} denied`);
  }, [_audit]);

  const deleteDataset = useCallback(async (d: DataSet, by: string) => {
    const doomed = snap.properties.filter(p => p.datasetId === d.id);
    const doomedLeads = snap.leads.filter(l => l.datasetId === d.id);
    await vaultRepo.deleteDataset(d.id, doomed.map(p => p.id), doomedLeads.map(l => l.id));
    const gone = new Set(doomed.map(p => p.id));
    const goneLeads = new Set(doomedLeads.map(l => l.id));
    setSnap(prev => copyState({
      ...prev,
      datasets: prev.datasets.filter(x => x.id !== d.id),
      properties: prev.properties.filter(p => !gone.has(p.id)),
      leads: prev.leads.filter(l => !goneLeads.has(l.id)),
    }));
    _audit(by, 'delete',
      `Deleted data set "${d.name}" — ` +
      `${d.module === 'leads' ? `${doomedLeads.length} leads` : `${doomed.length} units`} removed`);
  }, [snap.properties, snap.leads, _audit]);

  const undoDnc = useCallback(async (p: Property, by: string) => {
    p.state = PropertyState.pool;
    p.dncAt = undefined;
    p.lastOutcome = undefined;
    p.assignedAt = undefined;
    p.assignmentNote = undefined;
    p.updatedAt = new Date().toISOString();
    await vaultRepo.saveProperties([p]);
    setSnap(prev => copyState({ ...prev }));
    _audit(by, 'dnc-undo', 'Do-Not-Call removed (manager override)', [p.id]);
  }, [_audit]);

  const undoDncLead = useCallback(async (l: Lead, by: string) => {
    l.state = PropertyState.pool;
    l.dncAt = undefined;
    l.lastOutcome = undefined;
    l.assignedAt = undefined;
    l.assignmentNote = undefined;
    l.updatedAt = new Date().toISOString();
    await vaultRepo.saveLeads([l]);
    setSnap(prev => copyState({ ...prev }));
    _audit(by, 'dnc-undo', 'Do-Not-Call removed on lead (manager override)', [l.id]);
  }, [_audit]);

  const logCall = useCallback(async (
    properties: Property[], brokerId: string, outcome: CallOutcome,
    note?: string, followUpAt?: string,
  ) => {
    const now = new Date().toISOString();
    const call = new CallLog(
      `c-${Date.now()}`, kOrgId, properties.map(p => p.id), [],
      brokerId, now, outcome,
      (note?.trim().length ?? 0) > 0 ? note!.trim() : undefined,
      followUpAt,
    );
    for (const p of properties) {
      applyOutcome(p, outcome, now, followUpAt, snap.settings);
    }
    await vaultRepo.saveCall(call);
    await vaultRepo.saveProperties(properties);
    setSnap(prev => copyState({ ...prev, calls: [call, ...prev.calls] }));
    _audit(brokerId, 'call', `${outcome} — ${properties.length} unit(s)`);
  }, [snap.settings, _audit]);

  const logLeadCall = useCallback(async (
    lead: Lead, brokerId: string, outcome: CallOutcome,
    note?: string, followUpAt?: string,
  ) => {
    const now = new Date().toISOString();
    const call = new CallLog(
      `c-${Date.now()}`, kOrgId, [], [lead.id],
      brokerId, now, outcome,
      (note?.trim().length ?? 0) > 0 ? note!.trim() : undefined,
      followUpAt,
    );
    applyOutcome(lead, outcome, now, followUpAt, snap.settings);
    await vaultRepo.saveCall(call);
    await vaultRepo.saveLeads([lead]);
    setSnap(prev => copyState({ ...prev, calls: [call, ...prev.calls] }));
    _audit(brokerId, 'call', `${outcome} — lead`, [lead.id]);
  }, [snap.settings, _audit]);

  const value: VaultContextValue = {
    loading, ...snap,
    userById, brokers, callable, countIn, byUnitKey, communities, assignedTo,
    leadById, leadCountIn, byLeadKey, leadsOf, callsForLead, pendingRequests,
    callsFor, callsBy, viewsToday,
    saveUser, deleteUser, saveSettings, recordView,
    commitImport, commitLeadImport, assign, reclaim, assignLeads, reclaimLeads,
    submitRequest, approveRequest, denyRequest, deleteDataset, undoDnc, undoDncLead,
    logCall, logLeadCall,
  };

  return (
    <VaultContext.Provider value={value}>
      {children}
    </VaultContext.Provider>
  );
}

export function useVault(): VaultContextValue {
  const ctx = useContext(VaultContext);
  if (!ctx) throw new Error('useVault must be used within VaultProvider');
  return ctx;
}
