import React from 'react';
import { Icon, IconName } from './Icon';

/**
 * The dashboard language — the one place the platform is allowed to be beautiful
 * rather than purely technical. Both Home screens (manager and broker) are built
 * from these pieces: a champagne-lit hero slab, stat tiles, distribution bars, a
 * 14-day activity chart, progress lines and an adaptive column grid. Everything
 * else in the app stays tables. Ported from the Flutter dash.dart kit.
 */

export type HeroStat = { value: string; label: string };

export function HeroSlab({ title, subtitle, stats = [], actions, side }: {
  title: string;
  subtitle?: string;
  stats?: HeroStat[];
  actions?: React.ReactNode;
  side?: React.ReactNode;
}) {
  const headline = (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: '1.4rem', fontWeight: 600, color: 'var(--slab-fg)' }}>{title}</div>
      {subtitle && (
        <div style={{ marginTop: 2, fontSize: '0.875rem', color: 'var(--slab-muted)' }}>{subtitle}</div>
      )}
      {stats.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px', marginTop: 18 }}>
          {stats.map((s, i) => (
            <div key={i}>
              <div className="tabular-nums" style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--slab-gold)', lineHeight: 1.1 }}>{s.value}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--slab-muted)' }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}
      {actions && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 18 }}>{actions}</div>
      )}
    </div>
  );

  return (
    <div className="hero-slab">
      <div className="hero-glow" />
      <div className="hero-glow-2" />
      <div className="hero-inner" style={{
        display: 'flex', gap: 20,
        flexWrap: 'wrap', alignItems: side ? 'center' : 'flex-start',
      }}>
        <div style={{ flex: '1 1 340px', minWidth: 0 }}>{headline}</div>
        {side && <div style={{ flex: '0 1 auto' }}>{side}</div>}
      </div>
    </div>
  );
}

export function SlabAction({ icon, label, onClick, badge = 0, primary = false }: {
  icon: IconName; label: string; onClick: () => void; badge?: number; primary?: boolean;
}) {
  return (
    <button className={`slab-action${primary ? ' primary' : ''}`} onClick={onClick}>
      <Icon name={icon} size={17} />
      {label}
      {badge > 0 && <span className="slab-badge">{badge}</span>}
    </button>
  );
}

export function DashCard({ title, icon, trailing, flush = false, children }: {
  title: string; icon?: IconName; trailing?: React.ReactNode; flush?: boolean; children: React.ReactNode;
}) {
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div className="dash-card-head">
        {icon && <Icon name={icon} size={17} style={{ color: 'var(--primary)' }} />}
        <span className="title">{title}</span>
        {trailing}
      </div>
      <div style={{ padding: flush ? '8px 0 0' : '14px 16px 16px' }}>{children}</div>
    </div>
  );
}

export function StatTile({ value, label, color, icon }: {
  value: string; label: string; color?: string; icon?: IconName;
}) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        {icon && <Icon name={icon} size={15} style={{ color: color ?? 'var(--text-secondary)' }} />}
        <span className="tabular-nums" style={{ fontSize: '1.25rem', fontWeight: 700, color: color ?? 'var(--text)' }}>{value}</span>
      </div>
      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{label}</div>
    </div>
  );
}

export type Segment = { value: number; color: string; label: string };

export function SegmentBar({ segments, height = 12, legend = true }: {
  segments: Segment[]; height?: number; legend?: boolean;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const live = segments.filter(s => s.value > 0);
  return (
    <div>
      <div style={{ height, borderRadius: 999, overflow: 'hidden', display: 'flex', background: 'var(--surface-2)' }}>
        {total > 0 && live.map((s, i) => (
          <div key={i} style={{ flex: s.value, background: s.color }} />
        ))}
      </div>
      {legend && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', marginTop: 8 }}>
          {segments.map((s, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color }} />
              {s.label}{' '}
              <span className="tabular-nums" style={{ fontWeight: 700, color: 'var(--text)' }}>{s.value}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function MiniBarChart({ values, labels, height = 110 }: {
  values: number[]; labels: string[]; height?: number;
}) {
  const maxV = values.reduce((m, v) => (v > m ? v : m), 1);
  return (
    <div style={{ height, display: 'flex', alignItems: 'flex-end', gap: 6 }}>
      {values.map((v, i) => {
        const isToday = i === values.length - 1;
        const barH = v === 0 ? 3 : 8 + (height - 42) * v / maxV;
        return (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end' }}>
            {v > 0 && <span style={{ fontSize: '0.6875rem', color: 'var(--text-secondary)' }}>{v}</span>}
            <div style={{
              marginTop: 2, width: '100%', height: barH, borderRadius: 4,
              background: isToday ? 'var(--primary)' : 'color-mix(in srgb, var(--primary) 35%, transparent)',
              boxShadow: isToday && v > 0 ? '0 0 10px rgba(200,169,110,0.5)' : undefined,
            }} />
            <span style={{ marginTop: 4, fontSize: '0.6875rem', color: 'var(--text-secondary)' }}>{labels[i]}</span>
          </div>
        );
      })}
    </div>
  );
}

export function ProgressLine({ label, fraction, trailing, color }: {
  label: string; fraction: number; trailing?: string; color?: string;
}) {
  const f = Math.max(0, Math.min(1, fraction));
  return (
    <div style={{ padding: '5px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="truncate" style={{ flex: 1, fontSize: '0.75rem' }}>{label}</span>
        {trailing && <span className="tabular-nums" style={{ fontSize: '0.75rem', fontWeight: 700 }}>{trailing}</span>}
      </div>
      <div style={{ marginTop: 4, height: 6, borderRadius: 999, overflow: 'hidden', background: 'var(--surface-2)' }}>
        <div style={{ width: `${f * 100}%`, height: '100%', background: color ?? 'var(--primary)' }} />
      </div>
    </div>
  );
}

/** Lays children out in a responsive 1/2/3-column grid so dashboards use the whole screen. */
export function DashColumns({ children }: { children: React.ReactNode }) {
  return <div className="dash-grid">{children}</div>;
}
