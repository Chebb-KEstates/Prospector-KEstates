import React, {
  createContext, useContext, useState, useCallback, useEffect, useMemo, useRef,
} from 'react';
import {
  DataSet, Property, Lead, CallLog, BatchRequest, VaultSettings,
  RequestStatus, PropertyState, CallOutcome,
} from '../types/models';
import { AppUser, UserRole, Permission } from '../types/user';
import * as api from '../data/api';
import { useAuth } from './AuthContext';

/**
 * The vault, backed by the API.
 *
 * ── What changed and why it matters ────────────────────────────────────────
 *
 * The old context loaded EVERY dataset, property, lead, call, request, audit
 * entry and user into one in-memory `VaultSnapshot`, then served every question
 * by scanning arrays — recomputing `byUnitKey`, `communities`, `brokers` and
 * `callable` on every single render, unmemoised.
 *
 * That snapshot is gone. Properties and leads are paginated server-side now, so
 * there is no full array to fold over. What lives here is only what is small
 * and needed everywhere:
 *
 *   users · settings · datasets · requests — bounded, and referenced by name
 *   all over the UI (userById, brokers, pendingRequests).
 *
 * Everything else moved:
 *   - table rows        → usePropertyPage / useLeadPage (paginated queries)
 *   - dashboard numbers → api.dashboard.* (aggregated in SQL)
 *   - a broker's own set → myProperties / myLeads (bounded per broker)
 *
 * ── The mutate-in-place + copyState contract is gone too ───────────────────
 *
 * The old code mutated class instances and forced a re-render with
 * `setSnap(prev => copyState({...prev}))`. That only worked because the arrays
 * were local. Mutations now go to the server and we refetch what changed; a
 * mutation that used to be `p.state = ...; copyState()` is now `await
 * api...; await reload()`. Don't reintroduce local mutation — it will lie.
 */

interface VaultContextValue {
  loading: boolean;
  error: string | null;

  // Small, always-loaded collections.
  users: AppUser[];
  settings: VaultSettings;
  datasets: DataSet[];
  requests: BatchRequest[];

  // Derived from the above (cheap — these lists are small).
  userById: (id?: string) => AppUser | undefined;
  brokers: AppUser[];
  pendingRequests: BatchRequest[];

  reload: () => Promise<void>;
  reloadRequests: () => Promise<void>;

  // ── Mutations. Each returns after the server has confirmed. ──
  saveUser: (input: {
    id?: string; name: string; email: string; role: UserRole; team?: string;
    active?: boolean; permissions?: Permission[];
    ipLocked?: boolean; initialPassword?: string;
  }) => Promise<AppUser>;
  setUserActive: (user: AppUser, active: boolean) => Promise<void>;
  resetUserPassword: (userId: string, newPassword: string) => Promise<void>;
  saveSettings: (s: VaultSettings) => Promise<void>;

  assign: (propertyIds: string[], brokerId: string, note?: string) =>
    Promise<{ assigned: number; ownerLinkedExtra: number }>;
  reclaim: (propertyIds: string[]) => Promise<number>;
  assignLeads: (leadIds: string[], brokerId: string, note?: string) => Promise<number>;
  reclaimLeads: (leadIds: string[]) => Promise<number>;

  submitRequest: (input: {
    community: string; cluster?: string; count: number;
    unitIds?: string[]; note?: string;
  }) => Promise<void>;
  approveRequest: (req: BatchRequest) => Promise<number>;
  denyRequest: (req: BatchRequest) => Promise<void>;

  deleteDataset: (d: DataSet) => Promise<{ removedUnits: number; removedLeads: number }>;
  updateDataset: (id: string, patch: {
    name?: string; source?: string; communityLabel?: string; cost?: number | null;
  }) => Promise<DataSet>;
  reloadDatasets: () => Promise<void>;

  undoDnc: (p: Property) => Promise<void>;
  undoDncLead: (l: Lead) => Promise<void>;

  logCall: (properties: Property[], outcome: CallOutcome, note?: string, followUpAt?: string, ownerName?: string) => Promise<void>;
  logLeadCall: (lead: Lead, outcome: CallOutcome, note?: string, followUpAt?: string) => Promise<void>;

  /** The sanctioned reveal — single record, audited server-side. */
  revealPhone: (propertyId: string) => Promise<api.RevealResult>;
  revealLeadPhone: (leadId: string) => Promise<api.RevealResult>;
  recordView: (propertyId: string, what: string) => Promise<{ ok: true }>;

  /** Bumped after any write, so paged views know to refetch. */
  revision: number;
}

const VaultContext = createContext<VaultContextValue | null>(null);

export function VaultProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();

  const [users, setUsers] = useState<AppUser[]>([]);
  const [settings, setSettings] = useState<VaultSettings>(new VaultSettings());
  const [datasets, setDatasets] = useState<DataSet[]>([]);
  const [requests, setRequests] = useState<BatchRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  const bump = useCallback(() => setRevision(r => r + 1), []);
  const mounted = useRef(true);
  // Set true on every mount, not only false on cleanup. Under React 18
  // StrictMode the mount effect runs mount → unmount → remount; if we only ever
  // set this false (on the simulated unmount) it stays false forever, and every
  // `if (mounted.current) setX(...)` guard below silently no-ops — leaving
  // users, datasets, settings and requests permanently empty even though their
  // requests all return 200. Resetting it true on (re)mount keeps the guard
  // honest across StrictMode and any real remount.
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const reloadDatasets = useCallback(async () => {
    // Only manageData may list data sets; anyone else would get a 403.
    if (!user?.can(Permission.manageData)) return;
    const d = await api.datasets.list();
    if (mounted.current) setDatasets(d);
  }, [user]);

  const reloadRequests = useCallback(async () => {
    const r = await api.requests.list();
    if (mounted.current) setRequests(r);
  }, []);

  const reload = useCallback(async () => {
    if (!user) return;
    setError(null);
    try {
      // Fetched together on purpose: these are the small collections the whole
      // UI reads by name. Everything large is paginated elsewhere.
      const [u, s, r] = await Promise.all([
        api.users.list(),
        api.settings.load(),
        api.requests.list(),
      ]);
      if (!mounted.current) return;
      setUsers(u);
      setSettings(s);
      setRequests(r);

      // Data sets are manager-only, so they're fetched separately and allowed
      // to fail quietly for a broker.
      if (user.isManager) {
        try {
          const d = await api.datasets.list();
          if (mounted.current) setDatasets(d);
        } catch { /* a broker or a permission-less manager: no data sets pane */ }
      }
    } catch (err) {
      if (mounted.current) {
        setError(err instanceof Error ? err.message : 'Could not load your data.');
      }
    }
  }, [user]);

  useEffect(() => {
    if (!user) {
      // Signed out — drop everything rather than leaving another user's data
      // sitting in memory behind a login screen.
      setUsers([]);
      setDatasets([]);
      setRequests([]);
      setSettings(new VaultSettings());
      setLoading(false);
      return;
    }
    setLoading(true);
    void (async () => {
      await reload();
      if (mounted.current) setLoading(false);
    })();
  }, [user, reload]);

  const userById = useCallback(
    (id?: string) => (id ? users.find(u => u.id === id) : undefined),
    [users],
  );

  // Memoised, unlike the originals which recomputed on every render.
  const brokers = useMemo(() => users.filter(u => u.role === UserRole.broker), [users]);
  const pendingRequests = useMemo(
    () => requests.filter(r => r.status === RequestStatus.pending),
    [requests],
  );

  // ── Users ────────────────────────────────────────────────────────────────

  const saveUser = useCallback(async (input: {
    id?: string; name: string; email: string; role: UserRole; team?: string;
    active?: boolean; permissions?: Permission[];
    ipLocked?: boolean; initialPassword?: string;
  }): Promise<AppUser> => {
    const saved = input.id
      ? await api.users.update(input.id, {
          name: input.name, email: input.email, role: input.role,
          team: input.team, active: input.active,
          permissions: input.permissions,
          ipLocked: input.ipLocked,
        })
      : await api.users.create({
          name: input.name, email: input.email, role: input.role,
          team: input.team, active: input.active, permissions: input.permissions,
          ipLocked: input.ipLocked,
          initialPassword: input.initialPassword!,
        });

    setUsers(prev => {
      const exists = prev.some(u => u.id === saved.id);
      const next = exists ? prev.map(u => (u.id === saved.id ? saved : u)) : [...prev, saved];
      return next.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    });
    bump();
    return saved;
  }, [bump]);

  const setUserActive = useCallback(async (target: AppUser, active: boolean) => {
    const saved = await api.users.update(target.id, { active });
    setUsers(prev => prev.map(u => (u.id === saved.id ? saved : u)));
    bump();
  }, [bump]);

  const resetUserPassword = useCallback(async (userId: string, newPassword: string) => {
    await api.users.resetPassword(userId, newPassword);
  }, []);

  const saveSettings = useCallback(async (s: VaultSettings) => {
    const saved = await api.settings.save(s);
    setSettings(saved);
    bump();
  }, [bump]);

  // ── Assignment ───────────────────────────────────────────────────────────

  const assign = useCallback(async (propertyIds: string[], brokerId: string, note?: string) => {
    const r = await api.properties.assign(propertyIds, brokerId, note);
    bump();
    return r;
  }, [bump]);

  const reclaim = useCallback(async (propertyIds: string[]) => {
    const r = await api.properties.reclaim(propertyIds);
    bump();
    return r.reclaimed;
  }, [bump]);

  const assignLeads = useCallback(async (leadIds: string[], brokerId: string, note?: string) => {
    const r = await api.leads.assign(leadIds, brokerId, note);
    bump();
    return r.assigned;
  }, [bump]);

  const reclaimLeads = useCallback(async (leadIds: string[]) => {
    const r = await api.leads.reclaim(leadIds);
    bump();
    return r.reclaimed;
  }, [bump]);

  // ── Requests ─────────────────────────────────────────────────────────────

  const submitRequest = useCallback(async (input: {
    community: string; cluster?: string; count: number; unitIds?: string[]; note?: string;
  }) => {
    const req = await api.requests.submit(input);
    setRequests(prev => [req, ...prev]);
    bump();
  }, [bump]);

  const approveRequest = useCallback(async (req: BatchRequest) => {
    const r = await api.requests.approve(req.id);
    setRequests(prev => prev.map(x => (x.id === req.id ? r.request : x)));
    bump();
    return r.granted;
  }, [bump]);

  const denyRequest = useCallback(async (req: BatchRequest) => {
    const decided = await api.requests.deny(req.id);
    setRequests(prev => prev.map(x => (x.id === req.id ? decided : x)));
    bump();
  }, [bump]);

  // ── Data sets ────────────────────────────────────────────────────────────

  const deleteDataset = useCallback(async (d: DataSet) => {
    const r = await api.datasets.remove(d.id);
    setDatasets(prev => prev.filter(x => x.id !== d.id));
    bump();
    return { removedUnits: r.removedUnits, removedLeads: r.removedLeads };
  }, [bump]);

  const updateDataset = useCallback(async (id: string, patch: {
    name?: string; source?: string; communityLabel?: string; cost?: number | null;
  }) => {
    const updated = await api.datasets.update(id, patch);
    setDatasets(prev => prev.map(x => (x.id === updated.id ? updated : x)));
    bump();
    return updated;
  }, [bump]);

  // ── Calls / DNC ──────────────────────────────────────────────────────────

  const undoDnc = useCallback(async (p: Property) => {
    await api.properties.undoDnc(p.id);
    bump();
  }, [bump]);

  const undoDncLead = useCallback(async (l: Lead) => {
    await api.leads.undoDnc(l.id);
    bump();
  }, [bump]);

  const logCall = useCallback(async (
    props: Property[], outcome: CallOutcome, note?: string, followUpAt?: string, ownerName?: string,
  ) => {
    await api.calls.log({ propertyIds: props.map(p => p.id), outcome, note, followUpAt, ownerName });
    bump();
  }, [bump]);

  const logLeadCall = useCallback(async (
    lead: Lead, outcome: CallOutcome, note?: string, followUpAt?: string,
  ) => {
    await api.calls.logLead({ leadId: lead.id, outcome, note, followUpAt });
    bump();
  }, [bump]);

  // ── Reveal ───────────────────────────────────────────────────────────────

  const revealPhone = useCallback(
    (propertyId: string) => api.properties.reveal(propertyId),
    [],
  );
  const revealLeadPhone = useCallback(
    (leadId: string) => api.leads.reveal(leadId),
    [],
  );
  const recordView = useCallback(
    (propertyId: string, what: string) => api.properties.recordView(propertyId, what),
    [],
  );

  const value: VaultContextValue = {
    loading, error,
    users, settings, datasets, requests,
    userById, brokers, pendingRequests,
    reload, reloadRequests, reloadDatasets,
    saveUser, setUserActive, resetUserPassword, saveSettings,
    assign, reclaim, assignLeads, reclaimLeads,
    submitRequest, approveRequest, denyRequest,
    deleteDataset, updateDataset,
    undoDnc, undoDncLead,
    logCall, logLeadCall,
    revealPhone, revealLeadPhone, recordView,
    revision,
  };

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}

export function useVault(): VaultContextValue {
  const ctx = useContext(VaultContext);
  if (!ctx) throw new Error('useVault must be used within VaultProvider');
  return ctx;
}
