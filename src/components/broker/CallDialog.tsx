import React from 'react';
import { CallStop } from '../../state/CallSessionContext';
import { useAuth } from '../../state/AuthContext';
import { useVault } from '../../state/VaultContext';
import { CallCard } from './CallCard';
import { Icon } from '../common/Icon';

/**
 * The single-call popup (the Flutter showCallDialog): call ONE record straight
 * from a table row or detail panel, without starting a whole session. Reuses the
 * same rich CallCard so the flow is identical to the dialer.
 */
export function CallDialog({ stop, onClose }: { stop: CallStop; onClose: () => void }) {
  const { user } = useAuth();
  const vault = useVault();
  const onReveal = () => user && vault.recordView(user.id, user.isManager, `Revealed number — ${stop.name}`, false);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ width: 520, maxWidth: '94vw', padding: 0, background: 'transparent', border: 'none' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <button className="btn btn-icon" onClick={onClose} aria-label="Close" style={{ background: 'var(--surface)' }}>
            <Icon name="x" size={18} />
          </button>
        </div>
        <CallCard stop={stop} onReveal={onReveal} onComplete={onClose} onSkip={onClose} />
      </div>
    </div>
  );
}
