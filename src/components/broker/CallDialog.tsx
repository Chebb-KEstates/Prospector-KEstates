import React from 'react';
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
 */
export function CallDialog({ stop, onClose }: { stop: CallStop; onClose: () => void }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ width: 520, maxWidth: '94vw', padding: 0, background: 'transparent', border: 'none' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <button className="btn btn-icon" onClick={onClose} aria-label="Close" style={{ background: 'var(--surface)' }}>
            <Icon name="x" size={18} />
          </button>
        </div>
        <CallCard stop={stop} onComplete={onClose} onSkip={onClose} />
      </div>
    </div>
  );
}
