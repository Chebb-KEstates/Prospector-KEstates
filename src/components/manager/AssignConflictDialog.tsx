import React, { useState } from 'react';
import { Property } from '../../types/models';
import { Icon } from '../common/Icon';
import { fmtInt } from '../../utils/format';
import { UnitsDrilldownPopup } from './UnitsDrilldownPopup';

/**
 * Shown before a reassignment that would touch owners already being worked in
 * another broker's portfolio. The manager can reassign everyone anyway, or skip
 * those owners (leave them with the broker working them). The conflict count is
 * clickable → the units list → each unit's full record; closing a layer returns
 * to the one beneath, so this dialog stays put until the manager decides.
 */
export function AssignConflictDialog({
  brokerName, conflictOwners, conflictUnits, busy, onProceedAll, onSkip, onCancel,
}: {
  brokerName: string;
  conflictOwners: number;
  conflictUnits: Property[];
  busy: boolean;
  onProceedAll: () => void;
  onSkip: () => void;
  onCancel: () => void;
}) {
  const [showList, setShowList] = useState(false);
  const n = conflictUnits.length;

  return (
    <>
      <div className="modal-overlay" onClick={busy ? undefined : onCancel}>
        <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 500 }}>
          <h3 style={{ fontWeight: 600, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="alert" size={18} style={{ color: 'var(--warning)' }} /> Owners already being worked
          </h3>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: 8, lineHeight: 1.5 }}>
            {conflictOwners} owner{conflictOwners === 1 ? '' : 's'} in this selection {conflictOwners === 1 ? 'has' : 'have'} an
            interested unit in <b>another broker's portfolio</b> — a live deal being worked. Reassigning to <b>{brokerName}</b> would
            move or split {conflictOwners === 1 ? 'it' : 'them'}.
          </p>
          <button type="button" onClick={() => setShowList(true)}
            style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', cursor: 'pointer', color: 'var(--primary)', textDecoration: 'underline', marginBottom: 16, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <Icon name="eye" size={13} /> {fmtInt(n)} conflicting unit{n === 1 ? '' : 's'}
          </button>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button className="btn btn-sm btn-ghost" disabled={busy} onClick={onCancel}>Cancel</button>
            <button className="btn btn-sm" disabled={busy} onClick={onSkip} title="Leave those owners with the broker working them">
              {busy ? 'Working…' : 'Skip those owners'}
            </button>
            <button className="btn btn-sm btn-primary" disabled={busy} onClick={onProceedAll} title="Reassign everyone, including the units being worked">
              {busy ? 'Working…' : 'Reassign all'}
            </button>
          </div>
        </div>
      </div>

      {showList && (
        <UnitsDrilldownPopup
          title="Owners already being worked"
          subtitle={`in another broker's portfolio`}
          units={conflictUnits}
          onClose={() => setShowList(false)} />
      )}
    </>
  );
}
