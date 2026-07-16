import React from 'react';
import { useVault } from '../../state/VaultContext';
import { useAuth } from '../../state/AuthContext';
import { BatchRequest, RequestStatus } from '../../types/models';
import { fmtDateTime } from '../../utils/format';

export function RequestsScreen() {
  const { requests, pendingRequests, approveRequest, denyRequest, userById } = useVault();
  const { user } = useAuth();

  const handleApprove = async (req: BatchRequest) => {
    if (!user) return;
    await approveRequest(req, user.id);
  };

  const handleDeny = async (req: BatchRequest) => {
    if (!user) return;
    await denyRequest(req, user.id);
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
                        <button className="btn btn-sm btn-primary" onClick={() => handleApprove(req)}>
                          Approve
                        </button>
                        <button className="btn btn-sm btn-danger" onClick={() => handleDeny(req)}>
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
