import React, { useEffect, useRef, useState } from 'react';
import { useVault } from '../../state/VaultContext';
import { BatchRequest, RequestArea, RequestStatus, Property, UnitDecision } from '../../types/models';
import { fmtDateTime, fmtInt } from '../../utils/format';
import { UnitsDrilldownPopup } from './UnitsDrilldownPopup';
import { Col } from '../common/AnalyticsTable';
import * as api from '../../data/api';
import { ApiError } from '../../data/apiClient';

/** "Community · Sub-community" (or just the community when there's no sub). */
function areaLabel(a: RequestArea): string {
  const c = a.community || '(no community)';
  return a.cluster ? `${c} · ${a.cluster}` : c;
}

const plural = (n: number, one: string, many = `${one}s`) => `${fmtInt(n)} ${n === 1 ? one : many}`;

/** A hand-picked request closed as approved, but not every unit was granted. */
const isPartlyApproved = (r: BatchRequest) =>
  r.status === RequestStatus.approved && r.isHandPicked && r.grantedCount < r.unitIds.length;

export function RequestsScreen() {
  const { requests, pendingRequests, approveRequest, denyRequest, userById, reloadRequests, refreshRequest } = useVault();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The "view units" popup: the request (re-read fresh, so its per-unit
  // decisions are current) + its units, fetched before the popup opens.
  // `openingId` shows the row is busy while they load.
  const [popup, setPopup] = useState<{ request: BatchRequest; units: Property[] } | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const decide = async (req: BatchRequest, action: 'approve' | 'deny') => {
    if (busyId) return;
    setBusyId(req.id);
    setError(null);
    try {
      if (action === 'approve') {
        const { granted, considered } = await approveRequest(req);
        if (granted < considered) {
          setError(`Granted ${fmtInt(granted)} of ${fmtInt(considered)} — the rest are no longer available (left the pool, or the owner is with another broker).`);
        }
      } else {
        await denyRequest(req);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not decide that request.');
      if (err instanceof ApiError && (err.isConflict || err.status === 404)) await reloadRequests().catch(() => undefined);
    } finally {
      setBusyId(null);
    }
  };

  // Hand-picked requests carry their own unit ids — fetch them, then open the
  // shared drill-down popup (search / filters / sortable columns / open the record).
  const openUnits = async (req: BatchRequest) => {
    if (req.unitIds.length === 0 || openingId) return; // nothing hand-picked to show
    setOpeningId(req.id);
    setError(null);
    try {
      const [fresh, units] = await Promise.all([refreshRequest(req.id), api.requests.units(req.id)]);
      setPopup({ request: fresh, units });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load those units.');
      if (err instanceof ApiError && err.status === 404) await reloadRequests().catch(() => undefined);
    } finally {
      setOpeningId(null);
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
                  // Some units already decided in the popup: the row buttons act on the rest.
                  const partial = req.status === RequestStatus.pending && req.isHandPicked && req.decidedUnitCount > 0;
                  return (
                    <tr key={req.id}>
                      <td style={{ fontWeight: 500 }}>{userById(req.brokerId)?.name ?? req.brokerId}</td>
                      <td>
                        <AreaSummary areas={list} loading={openingId === req.id}
                          title={req.status === RequestStatus.pending ? 'View the requested units — approve or deny some of them' : 'View the requested units'}
                          onClick={clickable ? () => void openUnits(req) : undefined} />
                      </td>
                      <td className="tabular-nums" style={{ textAlign: 'right', fontWeight: 600 }}>{fmtInt(req.count)}</td>
                      <td>
                        <StatusChip req={req} />
                        {partial && (
                          <div style={{ fontSize: '0.6875rem', color: 'var(--text-secondary)', marginTop: 3, whiteSpace: 'nowrap' }}>
                            {fmtInt(req.decidedUnitCount)} of {fmtInt(req.unitIds.length)} decided
                          </div>
                        )}
                      </td>
                      <td className="tabular-nums" style={{ textAlign: 'right' }}>{req.grantedCount > 0 ? req.grantedCount : '—'}</td>
                      <td style={{ fontSize: '0.75rem' }}>{fmtDateTime(req.at)}</td>
                      <td>
                        {req.status === RequestStatus.pending && (
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button className="btn btn-sm btn-primary" disabled={busyId === req.id}
                              title={partial ? `Approve the ${req.pendingUnitIds.length} undecided unit(s)` : undefined}
                              onClick={() => decide(req, 'approve')}>
                              {busyId === req.id ? '…' : partial ? 'Approve rest' : 'Approve'}
                            </button>
                            <button className="btn btn-sm btn-danger" disabled={busyId === req.id}
                              title={partial ? `Deny the ${req.pendingUnitIds.length} undecided unit(s)` : undefined}
                              onClick={() => decide(req, 'deny')}>
                              {partial ? 'Deny rest' : 'Deny'}
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

      {popup && (
        <RequestUnitsPopup
          key={popup.request.id}
          initialRequest={popup.request}
          initialUnits={popup.units}
          brokerName={userById(popup.request.brokerId)?.name ?? popup.request.brokerId}
          onClose={() => setPopup(null)}
        />
      )}
    </div>
  );
}

function StatusChip({ req }: { req: BatchRequest }) {
  const tone = req.status === RequestStatus.approved ? 'var(--success)'
    : req.status === RequestStatus.denied ? 'var(--error)' : 'var(--warning)';
  return (
    <span className="chip" style={{ background: `color-mix(in srgb, ${tone} 20%, transparent)`, color: tone }}>
      {isPartlyApproved(req) ? 'partly approved' : req.status}
    </span>
  );
}

const DECISION_LOOK: Record<UnitDecision | 'pending', { label: string; tone: string }> = {
  pending: { label: 'Pending', tone: 'var(--warning)' },
  [UnitDecision.granted]: { label: 'Granted', tone: 'var(--success)' },
  [UnitDecision.denied]: { label: 'Denied', tone: 'var(--error)' },
  [UnitDecision.unavailable]: { label: 'Unavailable', tone: 'var(--text-tertiary)' },
};

type Notice = { tone: 'success' | 'warning' | 'error'; text: string };

/**
 * The units of one hand-picked request, with a checkbox per undecided unit and
 * Approve / Deny for the selection bottom-right. Decided units stay listed with
 * their decision; the request closes once none are left undecided.
 */
function RequestUnitsPopup({ initialRequest, initialUnits, brokerName, onClose }: {
  initialRequest: BatchRequest;
  initialUnits: Property[];
  brokerName: string;
  onClose: () => void;
}) {
  const { decideRequestUnits, refreshRequest } = useVault();
  const [request, setRequest] = useState(initialRequest);
  const [units, setUnits] = useState(initialUnits);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState<'approve' | 'deny' | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  // Results can land after the popup is closed — don't touch its state then.
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const open = request.status === RequestStatus.pending;
  const isUndecided = (p: Property) => open && !request.unitDecisions[p.id];
  const pendingCount = request.pendingUnitIds.length;

  const decisionCol: Col<Property> = {
    key: 'decision', label: 'Decision',
    render: p => {
      const d = request.unitDecisions[p.id];
      if (!d && !open) return <span style={{ color: 'var(--text-tertiary)' }}>—</span>;
      const look = DECISION_LOOK[d ?? 'pending'];
      return (
        <span className="chip" style={{ background: `color-mix(in srgb, ${look.tone} 18%, transparent)`, color: look.tone }}>
          {look.label}
        </span>
      );
    },
    sortValue: p => request.unitDecisions[p.id] ?? (open ? 'pending' : ''),
    exportValue: p => request.unitDecisions[p.id] ?? (open ? 'pending' : ''),
  };

  // Re-read the request + units after a refusal (someone else decided meanwhile),
  // and drop any selected unit that is no longer undecided.
  const resync = async () => {
    try {
      const [fresh, u] = await Promise.all([refreshRequest(request.id), api.requests.units(request.id)]);
      if (!alive.current) return;
      setRequest(fresh);
      setUnits(u);
      const still = new Set(fresh.status === RequestStatus.pending ? fresh.pendingUnitIds : []);
      setSelected(prev => new Set(Array.from(prev).filter(id => still.has(id))));
    } catch { /* the error notice already explains; the list stays as it was */ }
  };

  const decide = async (action: 'approve' | 'deny') => {
    const ids = Array.from(selected).filter(id => !request.unitDecisions[id]);
    if (ids.length === 0 || busy || !open) return;
    setBusy(action);
    setNotice(null);
    try {
      const r = await decideRequestUnits(request, action, ids);
      // Unit states changed (pool → assigned) — refresh the list behind the chips.
      const fresh = await api.requests.units(request.id).catch(() => null);
      if (!alive.current) return;
      setRequest(r.request);
      if (fresh) setUnits(fresh);
      setSelected(new Set());
      setNotice(summarise(r, action, brokerName));
    } catch (err) {
      if (!alive.current) return;
      setNotice({ tone: 'error', text: err instanceof ApiError ? err.message : 'Could not save that decision. Nothing was changed — please try again.' });
      if (err instanceof ApiError && (err.isConflict || err.status === 404)) await resync();
    } finally {
      if (alive.current) setBusy(null);
    }
  };

  const decidedCount = request.decidedUnitCount;
  const subtitle = `${brokerName} · ${fmtInt(request.count)} requested` +
    (decidedCount > 0 ? ` · ${fmtInt(decidedCount)} decided` : '');

  return (
    <UnitsDrilldownPopup
      title="Requested units"
      subtitle={subtitle}
      units={units}
      onClose={onClose}
      prefsKey="units.popup.requests.v1"
      leadColumns={[decisionCol]}
      selection={open ? {
        selected,
        onChange: setSelected,
        canSelect: isUndecided,
        disabled: busy !== null,
      } : undefined}
      notice={notice && <NoticeBar notice={notice} onDismiss={() => setNotice(null)} />}
      actions={shown => {
        if (!open) {
          return (
            <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
              This request is closed — {isPartlyApproved(request) ? 'partly approved' : request.status}
              {request.grantedCount > 0 ? ` (${plural(request.grantedCount, 'unit')} granted)` : ''}.
            </span>
          );
        }
        const n = selected.size;
        const shownIds = new Set(shown.map(p => p.id));
        const hidden = Array.from(selected).filter(id => !shownIds.has(id)).length;
        const none = n === 0 || busy !== null;
        const dim = (off: boolean): React.CSSProperties => (off ? { opacity: 0.45, cursor: 'not-allowed' } : {});
        return (
          <>
            <span style={{ fontSize: '0.8125rem', color: n > 0 ? 'var(--primary)' : 'var(--text-secondary)' }}>
              {n > 0
                ? `${fmtInt(n)} selected${hidden > 0 ? ` (${fmtInt(hidden)} hidden by filters)` : ''}`
                : `Select units to approve or deny · ${fmtInt(pendingCount)} undecided`}
            </span>
            {n > 0 && (
              <button className="btn btn-sm btn-ghost" onClick={() => setSelected(new Set())} disabled={busy !== null}>
                Clear
              </button>
            )}
            <button className="btn btn-sm btn-danger" disabled={none} style={dim(none)}
              onClick={() => void decide('deny')}
              title={n > 0 ? `Deny the ${plural(n, 'selected unit')}` : 'Select units first'}>
              {busy === 'deny' ? 'Denying…' : n > 0 ? `Deny ${fmtInt(n)}` : 'Deny'}
            </button>
            <button className="btn btn-sm btn-primary" disabled={none} style={dim(none)}
              onClick={() => void decide('approve')}
              title={n > 0 ? `Approve the ${plural(n, 'selected unit')} for ${brokerName}` : 'Select units first'}>
              {busy === 'approve' ? 'Approving…' : n > 0 ? `Approve ${fmtInt(n)}` : 'Approve'}
            </button>
          </>
        );
      }}
    />
  );
}

/** The one-line result of a decision, in the manager's terms. */
function summarise(r: api.UnitDecisionResult, action: 'approve' | 'deny', brokerName: string): Notice {
  const parts: string[] = [];
  if (action === 'approve') {
    parts.push(`${plural(r.granted, 'unit')} granted to ${brokerName}.`);
    if (r.unavailable > 0) {
      parts.push(`${plural(r.unavailable, 'unit was', 'units were')} no longer available (left the pool, or the owner is with another broker).`);
    }
    if (r.linkedInRequest > 0) {
      parts.push(`${plural(r.linkedInRequest, 'other requested unit')} of the same owner came along (an owner's units in one area are never split).`);
    }
    if (r.ownerLinkedExtra > 0) {
      parts.push(`Plus ${plural(r.ownerLinkedExtra, 'owner-linked unit')} outside this request.`);
    }
  } else {
    parts.push(`${plural(r.denied, 'unit')} denied.`);
  }
  const left = r.request.status === RequestStatus.pending ? r.request.pendingUnitIds.length : 0;
  parts.push(left > 0 ? `${fmtInt(left)} still undecided.` : 'The request is now closed.');
  return { tone: r.unavailable > 0 ? 'warning' : 'success', text: parts.join(' ') };
}

function NoticeBar({ notice, onDismiss }: { notice: Notice; onDismiss: () => void }) {
  const tone = notice.tone === 'success' ? 'var(--success)' : notice.tone === 'warning' ? 'var(--warning)' : 'var(--error)';
  return (
    <div role={notice.tone === 'error' ? 'alert' : 'status'} style={{
      display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 12px', borderRadius: 8, fontSize: '0.8125rem',
      border: `1px solid ${tone}`, background: `color-mix(in srgb, ${tone} 10%, transparent)`, color: 'var(--text)',
    }}>
      <span style={{ flex: 1 }}>{notice.text}</span>
      <button type="button" onClick={onDismiss} aria-label="Dismiss"
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '1rem', lineHeight: 1, padding: 0 }}>
        ×
      </button>
    </div>
  );
}

/** The per-area breakdown in a request's cell; clickable to open the units popup. */
function AreaSummary({ areas, onClick, loading, title }: { areas: RequestArea[]; onClick?: () => void; loading?: boolean; title?: string }) {
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
    <button type="button" onClick={onClick} disabled={loading} title={title}
      style={{ background: 'none', border: 'none', padding: 0, cursor: loading ? 'default' : 'pointer', textAlign: 'left', fontFamily: 'inherit', fontSize: 'inherit', color: 'var(--primary)', opacity: loading ? 0.6 : 1 }}>
      {body}
    </button>
  );
}
