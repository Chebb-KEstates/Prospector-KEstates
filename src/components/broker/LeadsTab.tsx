import React, { useState, useMemo } from 'react';
import { useAuth } from '../../state/AuthContext';
import { useVault } from '../../state/VaultContext';
import { Lead, PropertyState } from '../../types/models';
import { StateChip, OutcomeChip } from '../common/StateChip';
import { maskedPhone, fmtDate } from '../../utils/format';
import { Permission } from '../../types/user';

export function LeadsTab() {
  const [activeTab, setActiveTab] = useState<'assigned' | 'pool' | 'request'>('assigned');
  const [requestCount, setRequestCount] = useState(5);
  const [requestCommunity, setRequestCommunity] = useState('');
  const [requestNote, setRequestNote] = useState('');
  const { user } = useAuth();
  const { leadsOf, leads, submitRequest, properties, communities } = useVault();

  const poolLeads = useMemo(() => leads.filter(l => l.state === PropertyState.pool), [leads]);

  if (!user) return null;

  const myLeads = leadsOf(user.id);

  const handleRequest = async () => {
    if (!requestCommunity || requestCount < 1) return;
    await submitRequest(user.id, requestCommunity, requestCount, undefined, [], requestNote);
    setRequestCount(5);
    setRequestNote('');
  };

  return (
    <div>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 24 }}>
        Buyer Leads
      </h2>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className={`btn ${activeTab === 'assigned' ? 'btn-primary' : ''}`}
          onClick={() => setActiveTab('assigned')}>
          My Leads ({myLeads.length})
        </button>
        <button className={`btn ${activeTab === 'pool' ? 'btn-primary' : ''}`}
          onClick={() => setActiveTab('pool')}>
          Pool ({poolLeads.length})
        </button>
        {user.can(Permission.requestData) && (
          <button className={`btn ${activeTab === 'request' ? 'btn-primary' : ''}`}
            onClick={() => setActiveTab('request')}>
            Request
          </button>
        )}
      </div>

      {activeTab === 'request' && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ fontWeight: 600, marginBottom: 12 }}>Request Leads</h3>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                Community
              </label>
              <select className="input" value={requestCommunity}
                onChange={e => setRequestCommunity(e.target.value)}
                style={{ width: 200 }}>
                <option value="">Select community…</option>
                {communities.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                Count
              </label>
              <input className="input" type="number" value={requestCount}
                onChange={e => setRequestCount(parseInt(e.target.value) || 0)}
                style={{ width: 80 }} min={1} />
            </div>
            <div>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                Note (optional)
              </label>
              <input className="input" value={requestNote}
                onChange={e => setRequestNote(e.target.value)}
                style={{ width: 200 }} />
            </div>
            <button className="btn btn-primary" onClick={handleRequest}
              disabled={!requestCommunity || requestCount < 1}>
              Submit request
            </button>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Phone</th>
              <th>Email</th>
              <th>Project</th>
              <th>Source</th>
              <th>State</th>
              <th>Last Outcome</th>
            </tr>
          </thead>
          <tbody>
            {(activeTab === 'assigned' ? myLeads : poolLeads).length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 32, color: 'var(--text-tertiary)' }}>
                No leads.
              </td></tr>
            ) : (
              (activeTab === 'assigned' ? myLeads : poolLeads).map(l => (
                <tr key={l.id}>
                  <td style={{ fontWeight: 500 }}>{l.name || '—'}</td>
                  <td style={{ fontVariant: 'tabular-nums', color: 'var(--text-secondary)' }}>
                    {maskedPhone(l.phone)}
                  </td>
                  <td style={{ color: 'var(--text-secondary)' }}>{l.email ?? '—'}</td>
                  <td>{l.project ?? '—'}</td>
                  <td>{l.source ?? '—'}</td>
                  <td><StateChip state={l.state} /></td>
                  <td>{l.lastOutcome ? <OutcomeChip outcome={l.lastOutcome} buyer /> : '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
