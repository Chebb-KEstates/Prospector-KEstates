import React, { useState } from 'react';
import { AppUser } from '../../types/user';
import { Property } from '../../types/models';
import { Icon } from '../common/Icon';
import { fmtInt } from '../../utils/format';
import { UnitsDrilldownPopup } from './UnitsDrilldownPopup';

/**
 * Deactivating a broker who still holds units — decide what happens to them so
 * nothing is stranded: reclaim to the pool, reassign all to another agent, or
 * keep them on the (now-inactive) broker. The count is clickable → the units
 * list → each unit's full record, layered above this dialog.
 */
export function DeactivateBrokerDialog({
  broker, units, targets, busy, error, onReclaim, onReassign, onKeep, onCancel,
}: {
  broker: AppUser;
  units: Property[];
  /** Active brokers the units can be reassigned to (excludes this one). */
  targets: AppUser[];
  busy: boolean;
  error: string | null;
  onReclaim: () => void;
  onReassign: (targetId: string) => void;
  onKeep: () => void;
  onCancel: () => void;
}) {
  const [showList, setShowList] = useState(false);
  const [target, setTarget] = useState('');
  const n = units.length;

  const actionRow: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
    padding: '10px 0', borderTop: '1px solid var(--border-light)',
  };

  return (
    <>
      <div className="modal-overlay" onClick={busy ? undefined : onCancel}>
        <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 540 }}>
          <h3 style={{ fontWeight: 600, marginBottom: 8 }}>Deactivate {broker.name}</h3>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: 6, lineHeight: 1.5 }}>
            {broker.name} still holds <b>{fmtInt(n)}</b> unit{n === 1 ? '' : 's'}. Choose what happens to
            {n === 1 ? ' it' : ' them'} — the broker is signed out and can no longer sign in either way.
          </p>
          <button type="button" onClick={() => setShowList(true)}
            style={{ background: 'none', border: 'none', padding: 0, fontFamily: 'inherit', fontSize: 'inherit', cursor: 'pointer', color: 'var(--primary)', textDecoration: 'underline', marginBottom: 8, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <Icon name="eye" size={13} /> View {fmtInt(n)} unit{n === 1 ? '' : 's'}
          </button>

          <div style={actionRow}>
            <div style={{ flex: 1, minWidth: 180, fontSize: '0.85rem' }}><b>Reclaim to pool</b><br /><span style={{ color: 'var(--text-secondary)', fontSize: '0.78rem' }}>Return all their units to the pool.</span></div>
            <button className="btn btn-sm" disabled={busy} onClick={onReclaim}>{busy ? 'Working…' : 'Reclaim & deactivate'}</button>
          </div>

          <div style={actionRow}>
            <div style={{ flex: 1, minWidth: 180, fontSize: '0.85rem' }}><b>Reassign to an agent</b><br /><span style={{ color: 'var(--text-secondary)', fontSize: '0.78rem' }}>Move all their units to another broker.</span></div>
            <select className="input" value={target} disabled={busy} onChange={e => setTarget(e.target.value)} style={{ width: 'auto', minWidth: 140, padding: '5px 8px' }}>
              <option value="">Choose agent…</option>
              {targets.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <button className="btn btn-sm btn-primary" disabled={busy || !target} onClick={() => onReassign(target)}>{busy ? 'Working…' : 'Reassign & deactivate'}</button>
          </div>

          <div style={actionRow}>
            <div style={{ flex: 1, minWidth: 180, fontSize: '0.85rem' }}><b>Keep the units on them</b><br /><span style={{ color: 'var(--text-secondary)', fontSize: '0.78rem' }}>Deactivate now; they keep showing in reports until the units move.</span></div>
            <button className="btn btn-sm" disabled={busy} onClick={onKeep}>{busy ? 'Working…' : 'Deactivate & keep'}</button>
          </div>

          {error && (
            <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, fontSize: '0.8rem', background: 'color-mix(in srgb, var(--error) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--error) 45%, transparent)', color: 'var(--error)' }}>{error}</div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
            <button className="btn btn-sm btn-ghost" disabled={busy} onClick={onCancel}>Cancel</button>
          </div>
        </div>
      </div>

      {showList && (
        <UnitsDrilldownPopup title={`${broker.name}'s units`} subtitle="currently held" units={units} onClose={() => setShowList(false)} />
      )}
    </>
  );
}
