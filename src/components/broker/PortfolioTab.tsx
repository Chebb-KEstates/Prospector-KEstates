import React, { useState } from 'react';
import { useVault } from '../../state/VaultContext';
import { PropertyState } from '../../types/models';
import { PropertyTable } from '../manager/PropertyTable';
import { PropertyPopup } from '../manager/PropertyPopup';
import { Icon } from '../common/Icon';
import { ApiError } from '../../data/apiClient';

/**
 * Portfolio — the broker's long-hold units (state = portfolio).
 *
 * Clicking a unit opens the same 3-column record popup as the Database tab: an
 * audited, cap-counted owner view, then the property/call/journal work surface.
 * (Before, the Portfolio table had no row handler, so clicks did nothing.)
 */
export function PortfolioTab() {
  const vault = useVault();
  const [detailId, setDetailId] = useState<string | null>(null);
  const [pageIds, setPageIds] = useState<string[]>([]);
  const [capError, setCapError] = useState<string | null>(null);

  const openDetail = async (id: string, orderedIds: string[]) => {
    setCapError(null);
    try {
      await vault.recordView(id, `Viewed owner detail ${id}`);
      setPageIds(orderedIds);
      setDetailId(id);
    } catch (e) {
      setCapError(e instanceof ApiError ? e.message : 'Could not open that record.');
    }
  };

  return (
    <div>
      {detailId && (
        <PropertyPopup propertyId={detailId} ids={pageIds}
          onNavigate={(id) => void openDetail(id, pageIds)}
          onClose={() => setDetailId(null)} />
      )}
      {capError && (
        <div className="card" style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center', borderColor: 'var(--error)' }}>
          <Icon name="ban" size={16} style={{ color: 'var(--error)' }} />
          <span style={{ fontSize: '0.875rem', color: 'var(--error)' }}>{capError}</span>
        </div>
      )}

      <PropertyTable prefsKey="broker_portfolio" hideOwner
        scope="mine" fixedState={PropertyState.portfolio}
        onSelect={openDetail} />
    </div>
  );
}
