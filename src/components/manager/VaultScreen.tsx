import React, { useState, useMemo } from 'react';
import { useVault } from '../../state/VaultContext';
import { useAuth } from '../../state/AuthContext';
import { PropertyState, DataModule, DataModuleLabel } from '../../types/models';
import { PropertyTable } from './PropertyTable';
import { LeadTable } from './LeadTable';
import { PropertyDetail } from './PropertyDetail';
import { LeadDetail } from './LeadDetail';

export function VaultScreen() {
  const { properties, leads, recordView } = useVault();
  const { user } = useAuth();
  const [module, setModule] = useState<DataModule>(DataModule.owners);
  const [detailProperty, setDetailProperty] = useState<string | null>(null);
  const [detailLead, setDetailLead] = useState<string | null>(null);

  const handleViewProperty = (id: string) => {
    if (!user) return;
    const ok = recordView(user.id, user.isManager, `Viewed owner detail ${id}`);
    if (ok) setDetailProperty(id);
  };

  if (detailProperty) {
    return (
      <PropertyDetail
        propertyId={detailProperty}
        onBack={() => setDetailProperty(null)}
      />
    );
  }

  if (detailLead) {
    return (
      <LeadDetail
        leadId={detailLead}
        onBack={() => setDetailLead(null)}
      />
    );
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

      {module === DataModule.owners ? (
        <PropertyTable
          prefsKey="vault"
          properties={properties}
          onSelect={handleViewProperty}
        />
      ) : (
        <LeadTable
          leads={leads}
          onSelect={id => setDetailLead(id)}
        />
      )}
    </div>
  );
}
