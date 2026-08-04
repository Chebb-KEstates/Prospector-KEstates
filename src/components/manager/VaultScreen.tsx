import React, { useState } from 'react';
import { useVault } from '../../state/VaultContext';
import { DataModule, DataModuleLabel } from '../../types/models';
import { PropertyTable } from './PropertyTable';
import { LeadTable } from './LeadTable';
import { PropertyPopup } from './PropertyPopup';
import { LeadDetail } from './LeadDetail';
import { ApiError } from '../../data/apiClient';
import { Icon } from '../common/Icon';

export function VaultScreen() {
  const { recordView } = useVault();
  const [module, setModule] = useState<DataModule>(DataModule.owners);
  const [detailProperty, setDetailProperty] = useState<string | null>(null);
  // The current page's unit ids, in view order — drives "Next property".
  const [pageIds, setPageIds] = useState<string[]>([]);
  const [detailLead, setDetailLead] = useState<string | null>(null);
  const [capError, setCapError] = useState<string | null>(null);

  /**
   * Opening an owner's detail is an audited, cap-counted view.
   *
   * It used to be a synchronous `if (recordView(...))`. It's a server round trip
   * now, and it can refuse: a broker over their daily cap gets a 429 and the
   * detail does not open. Showing the record anyway would make the cap
   * decorative, which is what it was before.
   */
  const handleViewProperty = async (id: string) => {
    setCapError(null);
    try {
      await recordView(id, `Viewed owner detail ${id}`);
      setDetailProperty(id);
    } catch (err) {
      setCapError(err instanceof ApiError ? err.message : 'Could not open that record.');
    }
  };

  if (detailLead) {
    return <LeadDetail leadId={detailLead} onBack={() => setDetailLead(null)} />;
  }

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 24,
      }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Data Vault</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className={`btn ${module === DataModule.owners ? 'btn-primary' : ''}`}
            onClick={() => setModule(DataModule.owners)}
          >
            {DataModuleLabel[DataModule.owners]}
          </button>
          <button
            className={`btn ${module === DataModule.leads ? 'btn-primary' : ''}`}
            onClick={() => setModule(DataModule.leads)}
          >
            {DataModuleLabel[DataModule.leads]}
          </button>
        </div>
      </div>

      {capError && (
        <div className="card" style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center', borderColor: 'var(--error)' }}>
          <Icon name="ban" size={16} style={{ color: 'var(--error)' }} />
          <span style={{ fontSize: '0.875rem', color: 'var(--error)' }}>{capError}</span>
        </div>
      )}

      {module === DataModule.owners ? (
        <PropertyTable prefsKey="vault" scope="all" showAssignee
          onSelect={(id, orderedIds) => { setPageIds(orderedIds); void handleViewProperty(id); }} />
      ) : (
        <LeadTable prefsKey="vault_leads" scope="all" onSelect={id => setDetailLead(id)} />
      )}

      {detailProperty && (
        <PropertyPopup propertyId={detailProperty} ids={pageIds}
          onNavigate={handleViewProperty} onClose={() => setDetailProperty(null)} />
      )}
    </div>
  );
}
