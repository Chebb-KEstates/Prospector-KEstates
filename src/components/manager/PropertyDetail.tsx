import React, { useState, useEffect, useMemo } from 'react';
import { useVault } from '../../state/VaultContext';
import { useAuth } from '../../state/AuthContext';
import { PropertyTimeline } from './PropertyTimeline';
import { StateChip, OutcomeChip } from '../common/StateChip';
import { fmtDate, fmtAed, fmtArea } from '../../utils/format';
import { ownerRefOf, propertyRefOf } from '../../logic/ownerGrouping';
import { Icon } from '../common/Icon';
import { CallDialog } from '../broker/CallDialog';
import { ownerStopForProperty, stopDeps } from '../broker/callStops';
import { CallStop } from '../../state/CallSessionContext';
import { Property } from '../../types/models';
import * as api from '../../data/api';
import { ApiError } from '../../data/apiClient';

interface PropertyDetailProps {
  propertyId: string;
  onBack: () => void;
}

export function PropertyDetail({ propertyId, onBack }: PropertyDetailProps) {
  const vault = useVault();
  const { userById, revealPhone } = vault;
  const { user } = useAuth();
  const [p, setP] = useState<Property | null>(null);
  const [otherUnits, setOtherUnits] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [phone, setPhone] = useState<string | null>(null);
  const [revealError, setRevealError] = useState<string | null>(null);
  const [callStop, setCallStop] = useState<CallStop | null>(null);

  const deps = useMemo(
    () => stopDeps(vault.users, vault.logCall, vault.logLeadCall),
    [vault.users, vault.logCall, vault.logLeadCall],
  );

  // The record is fetched by id — there's no local vault array to search any more.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPhone(null);
    void (async () => {
      try {
        const [prop, owned] = await Promise.all([
          api.properties.byId(propertyId),
          api.properties.ownerUnits(propertyId).catch(() => [] as Property[]),
        ]);
        if (cancelled) return;
        setP(prop);
        setOtherUnits(owned.filter(u => u.id !== propertyId));
      } catch {
        if (!cancelled) setP(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [propertyId, vault.revision]);

  if (loading) {
    return (
      <div>
        <button className="btn btn-ghost" onClick={onBack}>← Back</button>
        <p style={{ marginTop: 16, color: 'var(--text-tertiary)' }}>Loading…</p>
      </div>
    );
  }

  if (!p) {
    return (
      <div>
        <button className="btn btn-ghost" onClick={onBack}>← Back</button>
        <p style={{ marginTop: 16, color: 'var(--text-tertiary)' }}>Property not found.</p>
      </div>
    );
  }

  /**
   * The one sanctioned reveal outside the dialer. It's a server round trip that
   * checks the cap and writes the audit entry; the number only appears if that
   * succeeded, so a revealed number and its audit record cannot come apart.
   */
  const doReveal = async () => {
    setRevealError(null);
    try {
      const r = await revealPhone(p.id, false);
      setPhone(r.phone);
    } catch (err) {
      setRevealError(err instanceof ApiError ? err.message : 'Could not fetch the number.');
    }
  };

  const startCall = async () => {
    setCallStop(await ownerStopForProperty(p, deps));
  };

  return (
    <div>
      {callStop && <CallDialog stop={callStop} onClose={() => setCallStop(null)} />}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <button className="btn btn-ghost" onClick={onBack}>← Back to vault</button>
        <div style={{ flex: 1 }} />
        {p.callable && (
          <button className="btn btn-primary" onClick={startCall}
            style={{ background: 'var(--gold)', borderColor: 'var(--gold)', color: '#2A2013' }}>
            <Icon name="phoneCall" size={16} /> Call owner
          </button>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        {/* Left: Owner info */}
        <div className="card">
          <h3 style={{ fontWeight: 600, marginBottom: 16 }}>Owner</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Name</span>
              <div style={{ fontWeight: 500 }}>{p.owner.name || '—'}</div>
            </div>
            <div>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Phone</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {/* p.owner.phone is the server-side mask until a reveal succeeds. */}
                <span style={{ fontWeight: 500, fontVariant: 'tabular-nums' }}>
                  {phone ?? p.owner.phone ?? '—'}
                </span>
                {!phone && p.owner.phone && (
                  <button className="btn btn-sm btn-ghost" onClick={doReveal} style={{ color: 'var(--primary)' }}>
                    <Icon name="eye" size={14} /> Reveal
                  </button>
                )}
              </div>
              {revealError && (
                <div style={{ fontSize: '0.75rem', color: 'var(--error)', marginTop: 4 }}>{revealError}</div>
              )}
            </div>
            <div>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Nationality</span>
              <div>{p.owner.nationality ?? '—'}</div>
            </div>
            {otherUnits.length > 0 && (
              <div>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Also owns</span>
                <div style={{ fontSize: '0.8125rem' }}>
                  {otherUnits.map(u => u.unitLabel).join(', ')}
                </div>
              </div>
            )}
            <div>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Owner Ref</span>
              <div style={{ fontVariant: 'tabular-nums' }}>{ownerRefOf(p)}</div>
            </div>
            <div>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Property Ref</span>
              <div style={{ fontVariant: 'tabular-nums' }}>{propertyRefOf(p)}</div>
            </div>
          </div>
        </div>

        {/* Right: Property info */}
        <div className="card">
          <h3 style={{ fontWeight: 600, marginBottom: 16 }}>Property</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Community</span>
              <div style={{ fontWeight: 500 }}>{p.community}</div>
            </div>
            {p.cluster && <div>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Sub-community</span>
              <div>{p.cluster}</div>
            </div>}
            <div>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Unit</span>
              <div>{p.unitLabel}</div>
            </div>
            <div>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Type</span>
              <div>{p.propertyType ?? '—'}</div>
            </div>
            <div>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Beds</span>
              <div>{p.beds != null ? p.beds : '—'}</div>
            </div>
            <div>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Size</span>
              <div>{fmtArea(p.sizeSqft)}</div>
            </div>
          </div>
        </div>

        {/* Status */}
        <div className="card">
          <h3 style={{ fontWeight: 600, marginBottom: 16 }}>Status</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>State</span>
              <StateChip state={p.state} />
            </div>
            {p.assignedTo && <div>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Assigned to</span>
              <div style={{ fontWeight: 500 }}>{userById(p.assignedTo)?.name ?? p.assignedTo}</div>
            </div>}
            {p.assignedAt && <div>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Assigned</span>
              <div>{fmtDate(p.assignedAt)}</div>
            </div>}
            {p.lastOutcome && <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Last outcome</span>
              <OutcomeChip outcome={p.lastOutcome} />
            </div>}
            <div>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Last called</span>
              <div>{fmtDate(p.lastCalledAt)}</div>
            </div>
            <div>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Call attempts</span>
              <div>{p.callAttempts}</div>
            </div>
          </div>
        </div>

        {/* Transaction info */}
        <div className="card">
          <h3 style={{ fontWeight: 600, marginBottom: 16 }}>Transaction</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Last transaction</span>
              <div>{fmtDate(p.lastTransactionDate)}</div>
            </div>
            <div>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Last value</span>
              <div style={{ fontWeight: 500 }}>{fmtAed(p.lastTransactionValue)}</div>
            </div>
            <div>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Transaction count</span>
              <div>{p.txCount}</div>
            </div>
            {p.rentAmount && <div>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Annual rent</span>
              <div>{fmtAed(p.rentAmount)}</div>
            </div>}
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div style={{ marginTop: 24 }}>
        <PropertyTimeline propertyId={p.id} />
      </div>
    </div>
  );
}
