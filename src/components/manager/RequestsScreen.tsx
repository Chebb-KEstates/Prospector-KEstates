import React, { useState } from 'react';
import { useVault } from '../../state/VaultContext';
import { BatchRequest, RequestArea, RequestStatus, Property } from '../../types/models';
import { fmtDateTime, fmtArea, fmtInt } from '../../utils/format';
import { StateChip } from '../common/StateChip';
import { Icon } from '../common/Icon';
import * as api from '../../data/api';
import { ApiError } from '../../data/apiClient';

/** "Community · Sub-community" (or just the community when there's no sub). */
function areaLabel(a: RequestArea): string {
  const c = a.community || '(no community)';
  return a.cluster ? `${c} · ${a.cluster}` : c;
}

export function RequestsScreen() {
  const { requests, pendingRequests, approveRequest, denyRequest, userById, reloadRequests } = useVault();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The "view units" popup: which request, its resolved units, and load state.
  const [unitsFor, setUnitsFor] = useState<BatchRequest | null>(null);
  const [units, setUnits] = useState<Property[]>([]);
  const [unitsLoading, setUnitsLoading] = useState(false);
  const [unitsError, setUnitsError] = useState<string | null>(null);

  const decide = async (req: BatchRequest, action: 'approve' | 'deny') => {
    if (busyId) return;
    setBusyId(req.id);
    setError(null);
    try {
      if (action === 'approve') {
        const granted = await approveRequest(req);
        if (granted < req.count) {
          setError(`Granted ${granted} of ${req.count} — the rest are no longer in the pool.`);
        }
      } else {
        await denyRequest(req);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not decide that request.');
      if (err instanceof ApiError && err.isConflict) await reloadRequests();
    } finally {
      setBusyId(null);
    }
  };

  const openUnits = async (req: BatchRequest) => {
    if (req.unitIds.length === 0) return; // nothing hand-picked to show
    setUnitsFor(req);
    setUnits([]);
    setUnitsError(null);
    setUnitsLoading(true);
    try {
      setUnits(await api.requests.units(req.id));
    } catch (err) {
      setUnitsError(err instanceof ApiError ? err.message : 'Could not load those units.');
    } finally {
      setUnitsLoading(false);
    }
  };

  return (
    <div>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 24 }}>
        Requests
        {pendingRequests.length > 0 && (
          <span className="chip" style={{ marginLeft: 8, background: 'var(--error)', color: 'white' }}>
            {pendingRequests.length} pending
          </span>
        )}
      </h2>

      {error && (
        <div className="card" style={{ marginBottom: 12, borderColor: 'var(--error)', color: 'var(--error)', fontSize: '0.875rem' }}>
          {error}
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Broker</th>
                <th>Requested areas</th>
                <th style={{ textAlign: 'right' }}>Total</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Granted</th>
                <th>Requested</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {requests.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: 32, color: 'var(--text-tertiary)' }}>
                  No requests yet.
                </td></tr>
              ) : (
                requests.map(req => {
                  const clickable = req.unitIds.length > 0;
                  const list = req.areas.length > 0
                    ? req.areas
                    : [{ community: req.community, cluster: req.cluster ?? '', count: req.count } as RequestArea];
                  return (
                    <tr key={req.id}>
                      <td style={{ fontWeight: 500 }}>{userById(req.brokerId)?.name ?? req.brokerId}</td>
                      <td>
                        <AreaSummary areas={list} onClick={clickable ? () => void openUnits(req) : undefined} />
                      </td>
                      <td className="tabular-nums" style={{ textAlign: 'right', fontWeight: 600 }}>{fmtInt(req.count)}</td>
                      <td>
                        <span className="chip" style={{
                          background: req.status === RequestStatus.approved ? 'var(--success)20' :
                            req.status === RequestStatus.denied ? 'var(--error)20' : 'var(--warning)20',
                          color: req.status === RequestStatus.approved ? 'var(--success)' :
                            req.status === RequestStatus.denied ? 'var(--error)' : 'var(--warning)',
                        }}>
                          {req.status}
                        </span>
                      </td>
                      <td className="tabular-nums" style={{ textAlign: 'right' }}>{req.grantedCount > 0 ? req.grantedCount : '—'}</td>
                      <td style={{ fontSize: '0.75rem' }}>{fmtDateTime(req.at)}</td>
                      <td>
                        {req.status === RequestStatus.pending && (
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button className="btn btn-sm btn-primary" disabled={busyId === req.id}
                              onClick={() => decide(req, 'approve')}>
                              {busyId === req.id ? '…' : 'Approve'}
                            </button>
                            <button className="btn btn-sm btn-danger" disabled={busyId === req.id}
                              onClick={() => decide(req, 'deny')}>
                              Deny
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {unitsFor && (
        <UnitsPopup
          request={unitsFor}
          brokerName={userById(unitsFor.brokerId)?.name ?? unitsFor.brokerId}
          units={units}
          loading={unitsLoading}
          error={unitsError}
          onClose={() => setUnitsFor(null)}
        />
      )}
    </div>
  );
}

/** The per-area breakdown in a request's cell; clickable to open the units popup. */
function AreaSummary({ areas, onClick }: { areas: RequestArea[]; onClick?: () => void }) {
  const body = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 200 }}>
      {areas.map((a, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
          <span className="truncate" style={{ fontSize: '0.8125rem' }}>{areaLabel(a)}</span>
          <span className="tabular-nums" style={{
            fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-secondary)',
            background: 'var(--surface-2)', borderRadius: 10, padding: '1px 7px', flexShrink: 0,
          }}>{a.count}</span>
        </div>
      ))}
    </div>
  );
  if (!onClick) return body;
  return (
    <button type="button" onClick={onClick} title="View the requested units"
      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', font: 'inherit', color: 'var(--primary)' }}>
      {body}
    </button>
  );
}

/** A modal listing the individual units of a request. */
function UnitsPopup({ request, brokerName, units, loading, error, onClose }: {
  request: BatchRequest; brokerName: string; units: Property[];
  loading: boolean; error: string | null; onClose: () => void;
}) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 900, width: '92vw', maxHeight: '86vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <h3 style={{ fontWeight: 600, margin: 0 }}>Requested units</h3>
          <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
            {brokerName} · {fmtInt(request.count)} unit{request.count === 1 ? '' : 's'}
          </span>
          <div style={{ flex: 1 }} />
          <button className="btn btn-sm btn-ghost" onClick={onClose}><Icon name="x" size={14} /> Close</button>
        </div>

        <div className="card" style={{ padding: 0, overflow: 'hidden', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ overflow: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Unit</th><th>Community</th><th>Sub-community</th>
                  <th style={{ textAlign: 'right' }}>Beds</th>
                  <th style={{ textAlign: 'right' }}>Size</th>
                  <th>State</th><th>Owner</th>
                </tr>
              </thead>
              <tbody>
                {error ? (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: 28, color: 'var(--error)' }}>{error}</td></tr>
                ) : loading ? (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: 28, color: 'var(--text-secondary)' }}>Loading…</td></tr>
                ) : units.length === 0 ? (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: 28, color: 'var(--text-tertiary)' }}>These units are no longer available.</td></tr>
                ) : units.map(p => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 500 }}>{p.unitLabel}</td>
                    <td>{p.community || '—'}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{p.cluster || '—'}</td>
                    <td className="tabular-nums" style={{ textAlign: 'right' }}>{p.beds ?? '—'}</td>
                    <td className="tabular-nums" style={{ textAlign: 'right' }}>{fmtArea(p.sizeSqft)}</td>
                    <td><StateChip state={p.state} /></td>
                    <td style={{ color: 'var(--text-secondary)' }}>{p.owner.name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
