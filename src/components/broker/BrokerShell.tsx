import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useVault } from '../../state/VaultContext';
import { useTheme } from '../../state/ThemeContext';
import { CallSessionProvider, useCallSession } from '../../state/CallSessionContext';
import { AccountSheet } from '../common/AccountSheet';
import { MarbleBackground } from '../common/MarbleBackground';
import { Icon, IconName } from '../common/Icon';
import { BrokerHome } from './BrokerHome';
import { TodayTab } from './TodayTab';
import { PropertyTable } from '../manager/PropertyTable';
import { PropertyState } from '../../types/models';
import { CallSessionView } from './CallSessionView';

type Tab = 'home' | 'today' | 'pool' | 'portfolio';

const NAV: { key: Tab; label: string; icon: IconName }[] = [
  { key: 'home', label: 'Home', icon: 'home' },
  { key: 'today', label: 'Today', icon: 'phone' },
  { key: 'pool', label: 'Pool', icon: 'layers' },
  { key: 'portfolio', label: 'Portfolio', icon: 'star' },
];

function BrokerShellInner() {
  const [activeTab, setActiveTab] = React.useState<Tab>('home');
  const { user } = useAuth();
  const { properties, assignedTo, leadsOf } = useVault();
  const { resolved } = useTheme();
  const { session, minimize, resume, end } = useCallSession();

  if (!user) return <Navigate to="/login" />;

  const now = new Date().toDateString();
  const todayCount =
    assignedTo(user.id).filter(p => p.lastCalledAt && new Date(p.lastCalledAt).toDateString() === now).length +
    leadsOf(user.id).filter(l => l.lastCalledAt && new Date(l.lastCalledAt).toDateString() === now).length;

  const go = (t: Tab) => {
    setActiveTab(t);
    if (session && !session.minimized) minimize();
  };

  const dialerOpen = session != null && !session.minimized;
  const remaining = session ? session.stops.length - session.index - 1 : 0;

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      background: resolved === 'dark' ? 'transparent' : 'var(--bg)', position: 'relative',
    }}>
      {resolved === 'dark' && <MarbleBackground />}

      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flex: 1 }}>
        {/* Sidebar */}
        <nav style={{
          width: 220, borderRight: '1px solid var(--border)', background: 'var(--surface)',
          display: 'flex', flexDirection: 'column', padding: 16,
        }}>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--gold)', marginBottom: 24, padding: '8px 12px' }}>
            Prospector
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {NAV.map(tab => (
              <button key={tab.key} className="btn btn-ghost" style={{
                justifyContent: 'flex-start', gap: 10, padding: '8px 12px', borderRadius: 8,
                background: activeTab === tab.key && !dialerOpen ? 'var(--surface-2)' : 'transparent',
                color: activeTab === tab.key && !dialerOpen ? 'var(--text)' : 'var(--text-secondary)',
                fontWeight: activeTab === tab.key ? 600 : 400,
              }} onClick={() => go(tab.key)}>
                <Icon name={tab.icon} size={17} />
                {tab.label}
                {tab.key === 'today' && todayCount > 0 && (
                  <span style={{ marginLeft: 'auto', background: 'var(--primary)', color: 'white', borderRadius: 999, padding: '1px 7px', fontSize: '0.6875rem', fontWeight: 600 }}>
                    {todayCount}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div style={{ padding: '8px 12px' }}><AccountSheet /></div>
        </nav>

        {/* Content */}
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', maxHeight: '100vh', overflow: 'hidden' }}>
          {/* Top bar */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '12px 24px',
            borderBottom: '1px solid var(--border)', minHeight: 56,
          }}>
            {dialerOpen ? (
              <>
                <span style={{ fontWeight: 600 }}>{session!.title}</span>
                <div style={{ flex: 1 }} />
                <button className="btn btn-sm" onClick={minimize}>
                  <Icon name="minimize" size={15} /> Minimize
                </button>
                <button className="btn btn-sm btn-danger" onClick={end}>End session</button>
              </>
            ) : session ? (
              <>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>You have a calling session in progress.</span>
                <div style={{ flex: 1 }} />
                <button className="btn btn-sm btn-primary" onClick={resume}>
                  <Icon name="play" size={15} /> Resume ({remaining + 1})
                </button>
                <button className="btn btn-sm btn-ghost" onClick={end}>End</button>
              </>
            ) : (
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', textTransform: 'capitalize' }}>{activeTab}</span>
            )}
          </div>

          {/* Body */}
          <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
            {dialerOpen ? (
              <CallSessionView />
            ) : (
              <>
                {activeTab === 'home' && <BrokerHome onGo={(t) => setActiveTab(t as Tab)} />}
                {activeTab === 'today' && <TodayTab />}
                {activeTab === 'pool' && (
                  <PropertyTable teaser properties={properties.filter(p => p.state === PropertyState.pool)} />
                )}
                {activeTab === 'portfolio' && (
                  <PropertyTable properties={assignedTo(user.id).filter(p => p.state === PropertyState.portfolio)} />
                )}
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

export function BrokerShell() {
  return (
    <CallSessionProvider>
      <BrokerShellInner />
    </CallSessionProvider>
  );
}
