import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Property, Lead } from '../types/models';
import * as api from './api';
import { ApiError } from './apiClient';
import { useVault } from '../state/VaultContext';

/**
 * Paged data hooks — what replaced the in-memory snapshot.
 *
 * These carry the three things every server-backed list needs and a local array
 * never did:
 *
 *  - DEBOUNCE, so typing in the search box doesn't fire a query per keystroke.
 *  - ABORT, so a slow page-1 response can't land after page-2 and show the
 *    wrong rows. This is the bug that makes naive server pagination feel broken.
 *  - `keepPrevious`, so the table doesn't blank out between pages. The old
 *    in-memory filter was instant; without this, going server-side would feel
 *    like a regression on every keystroke.
 */

export interface PagedResult<T> {
  rows: T[];
  total: number;
  loading: boolean;
  /** True only on the first load — lets callers show a skeleton once. */
  initialLoading: boolean;
  error: string | null;
  refetch: () => void;
}

const SEARCH_DEBOUNCE_MS = 250;

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export function usePropertyPage(query: api.PropertyQuery): PagedResult<Property> {
  const { revision } = useVault();
  const [rows, setRows] = useState<Property[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [everLoaded, setEverLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  // Only the free-text search debounces; a dropdown change should feel instant.
  const debouncedSearch = useDebounced(query.search ?? '', SEARCH_DEBOUNCE_MS);
  const key = JSON.stringify({ ...query, search: debouncedSearch });

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const parsed = JSON.parse(key) as api.PropertyQuery;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setLoading(true);
    void (async () => {
      try {
        const page = await api.properties.page(parsed, ctrl.signal);
        if (ctrl.signal.aborted) return;
        setRows(page.rows);
        setTotal(page.total);
        setError(null);
        setEverLoaded(true);
      } catch (err) {
        if (ctrl.signal.aborted || (err as Error).name === 'AbortError') return;
        // 401 is handled globally by AuthContext — don't also shout about it here.
        if (err instanceof ApiError && err.isAuth) return;
        setError(err instanceof Error ? err.message : 'Could not load these rows.');
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    })();

    return () => ctrl.abort();
  }, [key, revision, nonce]);

  const refetch = useCallback(() => setNonce(n => n + 1), []);

  return {
    rows, total, loading,
    initialLoading: loading && !everLoaded,
    error, refetch,
  };
}

export function useLeadPage(query: api.LeadQuery): PagedResult<Lead> {
  const { revision } = useVault();
  const [rows, setRows] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [everLoaded, setEverLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const debouncedSearch = useDebounced(query.search ?? '', SEARCH_DEBOUNCE_MS);
  const key = JSON.stringify({ ...query, search: debouncedSearch });

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const parsed = JSON.parse(key) as api.LeadQuery;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setLoading(true);
    void (async () => {
      try {
        const page = await api.leads.page(parsed, ctrl.signal);
        if (ctrl.signal.aborted) return;
        setRows(page.rows);
        setTotal(page.total);
        setError(null);
        setEverLoaded(true);
      } catch (err) {
        if (ctrl.signal.aborted || (err as Error).name === 'AbortError') return;
        if (err instanceof ApiError && err.isAuth) return;
        setError(err instanceof Error ? err.message : 'Could not load these rows.');
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    })();

    return () => ctrl.abort();
  }, [key, revision, nonce]);

  const refetch = useCallback(() => setNonce(n => n + 1), []);

  return { rows, total, loading, initialLoading: loading && !everLoaded, error, refetch };
}

/**
 * Filter options for a table.
 *
 * Scoped, not filtered: these describe the whole set the table can reach, so
 * picking a community doesn't erase every other option. Only `community` is
 * passed through, because the cluster list narrows to the chosen community —
 * which is what the client-side version did by filtering the array.
 */
export function usePropertyFacets(scope: {
  scope?: 'all' | 'mine' | 'pool'; assignedTo?: string; datasetId?: string; community?: string;
}): api.PropertyFacets | null {
  const { revision } = useVault();
  const [facets, setFacets] = useState<api.PropertyFacets | null>(null);
  const key = JSON.stringify(scope);

  useEffect(() => {
    const parsed = JSON.parse(key);
    const ctrl = new AbortController();
    void (async () => {
      try {
        const f = await api.properties.facets(parsed, ctrl.signal);
        if (!ctrl.signal.aborted) setFacets(f);
      } catch {
        // Facets are decoration: a failure should empty the dropdowns, never
        // break the table.
      }
    })();
    return () => ctrl.abort();
  }, [key, revision]);

  return facets;
}

export function useLeadFacets(scope: {
  scope?: 'all' | 'mine' | 'pool'; assignedTo?: string; datasetId?: string;
}): api.LeadFacets | null {
  const { revision } = useVault();
  const [facets, setFacets] = useState<api.LeadFacets | null>(null);
  const key = JSON.stringify(scope);

  useEffect(() => {
    const parsed = JSON.parse(key);
    const ctrl = new AbortController();
    void (async () => {
      try {
        const f = await api.leads.facets(parsed, ctrl.signal);
        if (!ctrl.signal.aborted) setFacets(f);
      } catch { /* see usePropertyFacets */ }
    })();
    return () => ctrl.abort();
  }, [key, revision]);

  return facets;
}

/** A broker's own assigned units — bounded, so it loads whole. Drives the dialer. */
export function useMyProperties(): { rows: Property[]; loading: boolean; refetch: () => void } {
  const { revision } = useVault();
  const [rows, setRows] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const r = await api.properties.mine();
        if (!cancelled) setRows(r);
      } catch {
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [revision, nonce]);

  return { rows, loading, refetch: useCallback(() => setNonce(n => n + 1), []) };
}

export function useMyLeads(): { rows: Lead[]; loading: boolean; refetch: () => void } {
  const { revision } = useVault();
  const [rows, setRows] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const r = await api.leads.mine();
        if (!cancelled) setRows(r);
      } catch {
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [revision, nonce]);

  return { rows, loading, refetch: useCallback(() => setNonce(n => n + 1), []) };
}

export function useManagerDashboard(days = 14) {
  const { revision } = useVault();
  const [data, setData] = useState<api.ManagerDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const d = await api.dashboard.manager(days);
        if (!cancelled) { setData(d); setError(null); }
      } catch (err) {
        if (!cancelled && !(err instanceof ApiError && err.isAuth)) {
          setError(err instanceof Error ? err.message : 'Could not load the dashboard.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [days, revision]);

  return { data, loading, error };
}

export function useTeamDashboard(range?: { from?: string; to?: string }) {
  const { revision } = useVault();
  const [data, setData] = useState<api.TeamDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const from = range?.from;
  const to = range?.to;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const d = await api.dashboard.team({ from, to });
        if (!cancelled) { setData(d); setError(null); }
      } catch (err) {
        if (!cancelled && !(err instanceof ApiError && err.isAuth)) {
          setError(err instanceof Error ? err.message : 'Could not load the team report.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [revision, from, to]);

  return { data, loading, error };
}

export function useBrokerDashboard() {
  const { revision } = useVault();
  const [data, setData] = useState<api.BrokerDashboard | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const d = await api.dashboard.broker();
        if (!cancelled) setData(d);
      } catch { /* the home dash degrades to zeros rather than erroring */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [revision]);

  return { data, loading };
}

/** Call history for a set of units — the dialer card's timeline. */
export function usePropertyCalls(propertyId?: string) {
  const { revision } = useVault();
  const [rows, setRows] = useState<import('../types/models').CallLog[]>([]);

  useEffect(() => {
    if (!propertyId) { setRows([]); return; }
    let cancelled = false;
    void (async () => {
      try {
        const r = await api.properties.calls(propertyId);
        if (!cancelled) setRows(r);
      } catch { if (!cancelled) setRows([]); }
    })();
    return () => { cancelled = true; };
  }, [propertyId, revision]);

  return rows;
}

/** Stable empty defaults, so callers can destructure without null checks. */
export const EMPTY_PROPERTY_FACETS: api.PropertyFacets = {
  communities: [], clusters: [], states: [], beds: [],
  nationalities: [], outcomes: [], propertyTypes: [], extraKeys: [],
};

export const EMPTY_LEAD_FACETS: api.LeadFacets = {
  states: [], projects: [], sources: [], outcomes: [], extraKeys: [],
};

/** Convenience: facets with defaults folded in. */
export function usePropertyFacetsOrEmpty(scope: Parameters<typeof usePropertyFacets>[0]) {
  const f = usePropertyFacets(scope);
  return useMemo(() => f ?? EMPTY_PROPERTY_FACETS, [f]);
}

export function useLeadFacetsOrEmpty(scope: Parameters<typeof useLeadFacets>[0]) {
  const f = useLeadFacets(scope);
  return useMemo(() => f ?? EMPTY_LEAD_FACETS, [f]);
}
