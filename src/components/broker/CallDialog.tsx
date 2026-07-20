import React, { useState } from 'react';
import { CallStop } from '../../state/CallSessionContext';
import { CallCard } from './CallCard';
import { Icon } from '../common/Icon';

/**
 * The single-call popup (the Flutter showCallDialog): call ONE record straight
 * from a table row or detail panel, without starting a whole session. Reuses the
 * same rich CallCard so the flow is identical to the dialer.
 *
 * The reveal used to be recorded here; it now lives inside `stop.reveal()`,
 * which is the audited server call — so there's no way to show a number without
 * the audit entry existing.
 *
 * Once the number is revealed, the dialog LOCKS: the close button and the
 * backdrop stop working until a result is saved, so a broker can't reveal a
 * number here and dismiss the popup without recording the call — the same rule
 * the coverflow dialer enforces.
 */
export function CallDialog({ stop, onClose }: { stop: CallStop; onClose: () => void }) {
  const [locked, setLocked] = useState(false);
  return (
    <div className="modal-overlay" onClick={() => { if (!locked) onClose(); }}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ width: 520, maxWidth: '94vw', padding: 0, background: 'transparent', border: 'none' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          {locked ? (
            <span style={{ fontSize: '0.72rem', color: 'var(--gold-dark)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Icon name="alert" size={12} /> Log the call to close
            </span>
          ) : (
            <button className="btn btn-icon" onClick={onClose} aria-label="Close" style={{ background: 'var(--surface)' }}>
              <Icon name="x" size={18} />
            </button>
          )}
        </div>
        <CallCard stop={stop} onComplete={onClose} onSkip={onClose} onLockChange={setLocked} />
      </div>
    </div>
  );
}
