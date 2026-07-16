import React, { useState, useMemo } from 'react';
import { useAuth } from '../../state/AuthContext';
import { useVault } from '../../state/VaultContext';
import { Property, Lead, CallOutcome, CallOutcomeLabel, CallOutcomeBuyerLabel } from '../../types/models';
import { StateChip } from '../common/StateChip';
import { groupByOwner, ownerKeyOf } from '../../logic/ownerGrouping';

export function CallSessionScreen() {
  const [mode, setMode] = useState<'owners' | 'leads'>('owners');
  const [currentGroupIndex, setCurrentGroupIndex] = useState(0);
  const [currentLeadIndex, setCurrentLeadIndex] = useState(0);
  const [selectedOutcome, setSelectedOutcome] = useState<CallOutcome | null>(null);
  const [note, setNote] = useState('');
  const [followUpDays, setFollowUpDays] = useState('');
  const [phoneRevealed, setPhoneRevealed] = useState(false);
  const [callActive, setCallActive] = useState(false);
  const [showDisposition, setShowDisposition] = useState(false);
  const [outcomeNote, setOutcomeNote] = useState('');
  const [lastCallResult, setLastCallResult] = useState<string | null>(null);

  const { user } = useAuth();
  const {
    properties, assignedTo, leadsOf, logCall,
    logLeadCall, settings, callable, userById,
  } = useVault();

  const userProps = user ? assignedTo(user.id).filter(p => p.callable) : [];
  const userLeads = user ? leadsOf(user.id).filter(l => l.callable) : [];
  const ownerGroups = useMemo(() => groupByOwner(userProps), [userProps]);
  const todayCalls = useMemo(() => {
    if (!user) return 0;
    const todayStr = new Date().toDateString();
    return properties.filter(p =>
      p.lastCalledAt && new Date(p.lastCalledAt).toDateString() === todayStr &&
      p.assignedTo === user.id
    ).length;
  }, [properties, user]);

  if (!user) return null;

  const currentGroup = ownerGroups[currentGroupIndex];
  const currentLead = userLeads[currentLeadIndex];
  const totalOwners = ownerGroups.length;
  const totalLeads = userLeads.length;

  const handleCall = () => {
    setPhoneRevealed(true);
    setCallActive(true);
    setTimeout(() => setShowDisposition(true), 1000);
  };

  const handleEndCall = async (outcome: CallOutcome) => {
    if (!user) return;
    setSelectedOutcome(outcome);

    if (mode === 'owners' && currentGroup) {
      const followUp = followUpDays ? new Date(Date.now() + parseInt(followUpDays) * 86400000).toISOString() : undefined;
      await logCall(currentGroup.properties, user.id, outcome, outcomeNote || undefined, followUp);
      setLastCallResult(`Logged: ${CallOutcomeLabel[outcome]} for ${currentGroup.properties.length} unit(s)`);
    } else if (mode === 'leads' && currentLead) {
      const followUp = followUpDays ? new Date(Date.now() + parseInt(followUpDays) * 86400000).toISOString() : undefined;
      await logLeadCall(currentLead, user.id, outcome, outcomeNote || undefined, followUp);
      setLastCallResult(`Logged: ${CallOutcomeBuyerLabel[outcome]} for ${currentLead.name}`);
    }

    setCallActive(false);
    setShowDisposition(false);
    setPhoneRevealed(false);
    setOutcomeNote('');
    setSelectedOutcome(null);
    setFollowUpDays('');

    // Auto-advance
    if (mode === 'owners' && currentGroupIndex < totalOwners - 1) {
      setTimeout(() => setCurrentGroupIndex(i => i + 1), 500);
    } else if (mode === 'leads' && currentLeadIndex < totalLeads - 1) {
      setTimeout(() => setCurrentLeadIndex(i => i + 1), 500);
    }
  };

  const skipOwner = () => {
    if (currentGroupIndex < totalOwners - 1) {
      setCurrentGroupIndex(i => i + 1);
      resetCallState();
    }
  };

  const resetCallState = () => {
    setCallActive(false);
    setShowDisposition(false);
    setPhoneRevealed(false);
    setOutcomeNote('');
    setSelectedOutcome(null);
    setLastCallResult(null);
  };

  const callableCount = mode === 'owners'
    ? userProps.length
    : userLeads.length;

  if (lastCallResult) {
    return (
      <div style={{ textAlign: 'center', padding: 48 }}>
        <div style={{ fontSize: '2rem', marginBottom: 16 }}>✓</div>
        <p style={{ marginBottom: 16 }}>{lastCallResult}</p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          {(mode === 'owners' && currentGroupIndex < totalOwners - 1) ||
           (mode === 'leads' && currentLeadIndex < totalLeads - 1) ? (
            <button className="btn btn-primary" onClick={() => { setLastCallResult(null); resetCallState(); }}>
              Next → {mode === 'owners' ? (currentGroupIndex + 2) : (currentLeadIndex + 2)} of {mode === 'owners' ? totalOwners : totalLeads}
            </button>
          ) : (
            <button className="btn" onClick={() => { setLastCallResult(null); setCurrentGroupIndex(0); setCurrentLeadIndex(0); }}>
              Start again
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Call Session</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className="chip" style={{ background: 'var(--surface-2)' }}>
            {todayCalls} called today
          </span>
          <span className="chip" style={{ background: 'var(--surface-2)' }}>
            {mode === 'owners' ? totalOwners : totalLeads} remaining
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className={`btn ${mode === 'owners' ? 'btn-primary' : ''}`}
          onClick={() => { setMode('owners'); resetCallState(); }}>
          Property Owners ({totalOwners})
        </button>
        <button className={`btn ${mode === 'leads' ? 'btn-primary' : ''}`}
          onClick={() => { setMode('leads'); resetCallState(); }}>
          Buyer Leads ({totalLeads})
        </button>
      </div>

      {callableCount === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 48 }}>
          <p style={{ color: 'var(--text-tertiary)' }}>
            No callable records. All your assigned records lack a valid phone number.
          </p>
        </div>
      )}

      {mode === 'owners' && currentGroup && (
        <div>
          {/* Progress bar */}
          <div style={{ height: 4, background: 'var(--border-light)', borderRadius: 2, marginBottom: 16 }}>
            <div style={{
              height: '100%', borderRadius: 2, background: 'var(--primary)',
              width: `${((currentGroupIndex + 1) / totalOwners) * 100}%`,
              transition: 'width 0.3s',
            }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
                <h3 style={{ fontWeight: 600 }}>Owner</h3>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>
                  {currentGroupIndex + 1} / {totalOwners}
                </span>
              </div>
              <div style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: 4 }}>
                {currentGroup.owner.name || 'Unknown'}
              </div>
              <div style={{
                fontSize: '1.5rem', fontWeight: 700, fontVariant: 'tabular-nums',
                color: phoneRevealed ? 'var(--text)' : 'var(--primary)',
                marginBottom: 8, letterSpacing: phoneRevealed ? 0 : 2,
                cursor: 'pointer',
              }} onClick={() => setPhoneRevealed(true)}>
                {phoneRevealed ? currentGroup.owner.phone : '••••••' + (currentGroup.owner.phone?.slice(-4) ?? '')}
              </div>
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>
                {currentGroup.owner.nationality ?? ''}
              </div>
            </div>

            <div className="card">
              <h3 style={{ fontWeight: 600, marginBottom: 12 }}>
                Properties ({currentGroup.properties.length})
              </h3>
              {currentGroup.properties.map(p => (
                <div key={p.id} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '8px 0', borderBottom: '1px solid var(--border-light)',
                }}>
                  <div>
                    <div style={{ fontWeight: 500 }}>{p.unitLabel}</div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                      {p.community}{p.beds ? ` · ${p.beds} bed` : ''}
                    </div>
                  </div>
                  <StateChip state={p.state} />
                </div>
              ))}
            </div>
          </div>

          {/* Call controls */}
          <div className="card" style={{ marginTop: 16, textAlign: 'center' }}>
            {!callActive ? (
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                <button className="btn btn-primary" onClick={handleCall}
                  style={{ padding: '12px 32px', fontSize: '1rem' }}>
                  Call now
                </button>
                {!phoneRevealed && (
                  <button className="btn btn-ghost" onClick={() => setPhoneRevealed(true)}>
                    Reveal number
                  </button>
                )}
                <button className="btn btn-ghost" onClick={skipOwner}>
                  Skip
                </button>
              </div>
            ) : (
              <div>
                <p style={{ marginBottom: 16, color: 'var(--text-secondary)' }}>
                  Call in progress… (simulated)
                </p>

                {showDisposition && (
                  <div>
                    <h4 style={{ fontWeight: 600, marginBottom: 12 }}>Log Outcome</h4>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginBottom: 16 }}>
                      {Object.values(CallOutcome).map(o => (
                        <button
                          key={o}
                          className={`btn btn-sm ${selectedOutcome === o ? 'btn-primary' : ''}`}
                          onClick={() => setSelectedOutcome(o)}
                          style={{
                            borderColor: selectedOutcome === o ? undefined :
                              o === CallOutcome.interestedSell ? 'var(--success)' :
                              o === CallOutcome.dnc ? 'var(--error)' : undefined,
                          }}
                        >
                          {CallOutcomeLabel[o]}
                        </button>
                      ))}
                    </div>

                    <div style={{ maxWidth: 400, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <input className="input" placeholder="Notes (optional)"
                        value={outcomeNote} onChange={e => setOutcomeNote(e.target.value)} />
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input className="input" type="number" placeholder="Follow-up in days"
                          value={followUpDays} onChange={e => setFollowUpDays(e.target.value)}
                          style={{ width: 160 }} min={1} />
                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>days</span>
                      </div>
                    </div>

                    <button className="btn btn-primary" disabled={!selectedOutcome}
                      onClick={() => selectedOutcome && handleEndCall(selectedOutcome)}
                      style={{ marginTop: 16, padding: '10px 32px' }}>
                      Log call
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {mode === 'leads' && currentLead && (
        <div>
          <div style={{ height: 4, background: 'var(--border-light)', borderRadius: 2, marginBottom: 16 }}>
            <div style={{
              height: '100%', borderRadius: 2, background: 'var(--primary)',
              width: `${((currentLeadIndex + 1) / totalLeads) * 100}%`,
              transition: 'width 0.3s',
            }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
                <h3 style={{ fontWeight: 600 }}>Lead</h3>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>
                  {currentLeadIndex + 1} / {totalLeads}
                </span>
              </div>
              <div style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: 4 }}>
                {currentLead.name || 'Unknown'}
              </div>
              <div style={{
                fontSize: '1.5rem', fontWeight: 700, fontVariant: 'tabular-nums',
                color: phoneRevealed ? 'var(--text)' : 'var(--primary)',
                marginBottom: 8, cursor: 'pointer',
              }} onClick={() => setPhoneRevealed(true)}>
                {phoneRevealed ? currentLead.phone : '••••••' + (currentLead.phone?.slice(-4) ?? '')}
              </div>
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>
                {currentLead.email ?? ''}
              </div>
              <div style={{ marginTop: 8 }}>
                <span className="StateChip">{currentLead.project ?? ''}</span>
              </div>
            </div>

            <div className="card">
              <h3 style={{ fontWeight: 600, marginBottom: 12 }}>Extra Info</h3>
              {Object.keys(currentLead.extra).length > 0 ? (
                Object.entries(currentLead.extra).map(([k, v]) => (
                  <div key={k} style={{ marginBottom: 4 }}>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>{k}: </span>
                    <span>{v}</span>
                  </div>
                ))
              ) : (
                <p style={{ color: 'var(--text-tertiary)', fontSize: '0.8125rem' }}>No extra fields.</p>
              )}
            </div>
          </div>

          <div className="card" style={{ marginTop: 16, textAlign: 'center' }}>
            {!callActive ? (
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                <button className="btn btn-primary" onClick={handleCall}
                  style={{ padding: '12px 32px', fontSize: '1rem' }}>
                  Call now
                </button>
                <button className="btn btn-ghost" onClick={() => setPhoneRevealed(true)}>
                  Reveal number
                </button>
                <button className="btn btn-ghost"
                  onClick={() => { if (currentLeadIndex < totalLeads - 1) setCurrentLeadIndex(i => i + 1); resetCallState(); }}>
                  Skip
                </button>
              </div>
            ) : (
              <div>
                <p style={{ marginBottom: 16, color: 'var(--text-secondary)' }}>
                  Call in progress…
                </p>

                {showDisposition && (
                  <div>
                    <h4 style={{ fontWeight: 600, marginBottom: 12 }}>Log Outcome</h4>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginBottom: 16 }}>
                      {Object.values(CallOutcome).map(o => (
                        <button key={o} className={`btn btn-sm ${selectedOutcome === o ? 'btn-primary' : ''}`}
                          onClick={() => setSelectedOutcome(o)}>
                          {CallOutcomeBuyerLabel[o]}
                        </button>
                      ))}
                    </div>

                    <input className="input" placeholder="Notes (optional)" style={{ maxWidth: 400, margin: '0 auto 8px' }}
                      value={outcomeNote} onChange={e => setOutcomeNote(e.target.value)} />

                    <button className="btn btn-primary" disabled={!selectedOutcome}
                      onClick={() => selectedOutcome && handleEndCall(selectedOutcome)}
                      style={{ padding: '10px 32px' }}>
                      Log call
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
