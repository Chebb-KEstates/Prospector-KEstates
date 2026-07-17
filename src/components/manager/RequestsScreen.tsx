import React, { useState } from 'react';
import { useVault } from '../../state/VaultContext';
import { BatchRequest, RequestStatus } from '../../types/models';
import { fmtDateTime } from '../../utils/format';
import { ApiError } from '../../data/apiClient';

export function RequestsScreen() {
  const { requests, pendingRequests, approveRequest, denyRequest, userById, reloadRequests } = useVault();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Approve/deny are decided under a row lock server-side. A second manager
   * racing the same request gets a 409 rather than double-granting the units —
   * surfaced here, and the list is refreshed so they can see what actually
   * happened instead of a stale Pending badge.
   */
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
        <table className="data-table">
          <thead>
            <tr>
              <th>Broker</th>
              <th>Summary</th>
              <th>Community</th>
              <th>Count</th>
              <th>Status</th>
              <th>Granted</th>
              <th>Requested</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {requests.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: 32, color: 'var(--text-tertiary)' }}>
                No requests yet.
              </td></tr>
            ) : (
              requests.map(req => (
                <tr key={req.id}>
                  <td style={{ fontWeight: 500 }}>{userById(req.brokerId)?.name ?? req.brokerId}</td>
                  <td>{req.summary}</td>
                  <td>{req.cluster ?? req.community}</td>
                  <td>{req.count}</td>
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
                  <td>{req.grantedCount > 0 ? req.grantedCount : '—'}</td>
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
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
