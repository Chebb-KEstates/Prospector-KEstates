import React, { useEffect, useMemo, useState } from 'react';
import { useVault } from '../../state/VaultContext';
import { CallStop, CallUnit } from '../../state/CallSessionContext';
import { CallOutcome, CallOutcomeLabel } from '../../types/models';
import type { PhoneEntry, Property } from '../../types/models';
import { StateChip, CountdownBadge } from '../common/StateChip';
import { Icon } from '../common/Icon';
import { ApiError } from '../../data/apiClient';
import { ToneChip, sectionLabel, UnitDetailDialog } from '../broker/callVisuals';
import { ownerStopForProperty, stopDeps } from '../broker/callStops';
import { splitOwnerNames } from '../../utils/format';
import * as api from '../../data/api';

/**
 * The owner/property popup — the manager's read-only equivalent of the call
 * card. Opened by clicking a unit in the Data Vault / Assignments table, so a
 * detail is a quick pop-up rather than a full-page swap. Shows the owner, the
 * whole portfolio, and (per unit, via the shared dialog) all call feedback plus
 * editable notes. Reuses buildOwnerStop, so it stays in step with the caller view.
 */
export function PropertyPopup({ propertyId, onClose }: { propertyId: string; onClose: () => void }) {
  const vault = useVault();
  const deps = useMemo(
    () => stopDeps(vault.users, vault.logCall, vault.logLeadCall),
    [vault.users, vault.logCall, vault.logLeadCall],
  );

  const [stop, setStop] = useState<CallStop | null>(null);
  // Kept alongside the stop purely for the assignment timer — CallStop has no
  // deadline of its own, and the manager wants to see the clock here too.
  const [prop, setProp] = useState<Property | null>(null);
  const [loading, setLoading] = useState(true);
  const [openUnit, setOpenUnit] = useState<CallUnit | null>(null);
  const [noteOverrides, setNoteOverrides] = useState<Record<string, string>>({});
  const [phones, setPhones] = useState<PhoneEntry[] | null>(null);
  const [revealedOwners, setRevealedOwners] = useState<{ name: string; phones: PhoneEntry[] }[]>([]);
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const p = await api.properties.byId(propertyId);
        const s = await ownerStopForProperty(p, deps);
        if (!cancelled) { setProp(p); setStop(s); }
      } catch {
        if (!cancelled) { setProp(null); setStop(null); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [propertyId, deps]);

  const label = (o: CallOutcome) => CallOutcomeLabel[o];
  // Real co-owners (each with their own number) when the import found several;
  // fall back to splitting a lone joined cell for legacy single-owner rows.
  const coOwners = prop?.hasMultipleOwners ? prop.allOwners : [];
  const ownerNames = coOwners.length > 1 ? coOwners.map(o => o.name) : splitOwnerNames(stop?.name);
  const realPhonesFor = (name: string) => revealedOwners.find(r => r.name === name)?.phones;

  const doReveal = async () => {
    if (!stop || revealing) return;
    setRevealing(true);
    setRevealError(null);
    try {
      const r = await stop.reveal();
      setPhones(r.phones);
      setRevealedOwners(r.owners);
    } catch (e) {
      setRevealError(e instanceof ApiError ? e.message : 'Could not fetch the number.');
    } finally {
      setRevealing(false);
    }
  };

  return (
    <>
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content" onClick={e => e.stopPropagation()}
          style={{ maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 12, maxHeight: '85vh', overflow: 'auto' }}>
          {loading ? (
            <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-secondary)' }}>Loading…</div>
          ) : !stop ? (
            <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-secondary)' }}>Property not found.</div>
          ) : (
            <>
              {/* Owner header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 40, height: 40, borderRadius: '50%', flexShrink: 0, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>{stop.flag}</div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: '1.05rem', fontWeight: 600, lineHeight: 1.2 }} className="truncate">{stop.name}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }} className="truncate">
                    {[ownerNames.length > 1 ? `${ownerNames.length} owners` : null, stop.nationality, stop.subtitle].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  <StateChip state={stop.state} />
                  <CountdownBadge deadline={prop?.assignmentExpiresAt} soonHours={vault.settings.expiringSoonHours} />
                </span>
                <button className="btn btn-icon btn-sm" onClick={onClose} aria-label="Close"><Icon name="x" size={16} /></button>
              </div>

              {/* Co-owners — each with their OWN number. Masked until the number
                  below is revealed, then shown per owner. */}
              {coOwners.length > 1 && (
                <div style={{ padding: '8px 12px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                  <div style={sectionLabel}>Owners ({coOwners.length})</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                    {coOwners.map((o, i) => {
                      const real = realPhonesFor(o.name);
                      const nums = real ?? o.allPhones;
                      return (
                        <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 600, fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                            <Icon name="user" size={13} style={{ color: 'var(--text-tertiary)' }} /> {o.name || `Owner ${i + 1}`}
                          </span>
                          <span className="tabular-nums" style={{ fontSize: '0.8rem', color: real ? 'var(--text)' : 'var(--text-tertiary)', fontWeight: real ? 600 : 400 }}>
                            {nums.length > 0 ? nums.map(p => p.number).join('  ·  ') : '—'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Seller signals */}
              {stop.signals && stop.signals.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {stop.signals.map((s, i) => <ToneChip key={i} tone={s.tone}>{s.label}</ToneChip>)}
                </div>
              )}

              {/* Contact — masked until revealed (audited, capped). Once revealed,
                  the numbers WRAP: an owner with 3-4 mobiles would otherwise have
                  Mobile 3/4 clipped by a single-line ellipsis. Each entry stays
                  whole (no break mid-number); the row grows to as many lines as
                  it needs. */}
              {stop.phoneMasked && (
                <div style={{ display: 'flex', alignItems: phones ? 'flex-start' : 'center', gap: 10, padding: '8px 12px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                  <Icon name="phone" size={15} style={{ color: 'var(--text-secondary)', flexShrink: 0, marginTop: phones ? 3 : 0 }} />
                  {phones ? (
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexWrap: 'wrap', gap: '3px 14px' }}>
                      {phones.map((p, i) => (
                        <span key={i} className="tabular-nums" style={{ fontWeight: 600, letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>
                          <span style={{ color: 'var(--text-tertiary)', fontWeight: 500 }}>{p.label}:</span> {p.number}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <>
                      <span className="tabular-nums truncate" style={{ flex: 1, fontWeight: 600, letterSpacing: '0.5px' }}>
                        {stop.phoneMasked}
                      </span>
                      <button className="btn btn-sm" onClick={doReveal} disabled={revealing} style={{ flexShrink: 0 }}>
                        <Icon name="eye" size={14} /> {revealing ? '…' : 'Reveal'}
                      </button>
                    </>
                  )}
                </div>
              )}
              {revealError && <div style={{ color: 'var(--error)', fontSize: '0.75rem' }}>{revealError}</div>}

              {/* Portfolio — click a unit for its feedback + notes */}
              <div>
                <div style={sectionLabel}>{stop.assetsTitle}</div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {stop.units?.map((u, i) => (
                    <div key={u.id} onClick={() => setOpenUnit(u)} title="View details, call feedback & notes"
                      style={{ padding: '8px 6px', margin: '0 -6px', borderRadius: 8, cursor: 'pointer', borderTop: i > 0 ? '1px solid var(--border-light)' : undefined }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
                        <span style={{ fontWeight: 600, fontSize: '0.8125rem', display: 'inline-flex', alignItems: 'center', gap: 5 }} className="truncate">
                          {u.label}
                          {(noteOverrides[u.id] ?? u.notes) && <span title="Has notes" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--gold)' }} />}
                        </span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                          {u.rental && <ToneChip tone={u.rental.tone}>{u.rental.label}</ToneChip>}
                          {u.history.length > 0 && <span style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)' }}>{u.history.length} call{u.history.length === 1 ? '' : 's'}</span>}
                          <Icon name="chevronRight" size={14} style={{ color: 'var(--text-tertiary)' }} />
                        </span>
                      </div>
                      {u.location && <div className="truncate" style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>{u.location}</div>}
                      {u.facts.length > 0 && <div className="truncate" style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{u.facts.join(' · ')}</div>}
                      {u.lastSale && <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>Last sale: <span style={{ color: 'var(--text-secondary)' }}>{u.lastSale}</span></div>}
                    </div>
                  ))}
                </div>
              </div>

              {stop.note && (
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', paddingTop: 8, borderTop: '1px solid var(--border-light)' }}>
                  <b>Internal note:</b> {stop.note}
                </div>
              )}

              <div><button className="btn" onClick={onClose}>Close</button></div>
            </>
          )}
        </div>
      </div>

      {openUnit && stop && (
        <UnitDetailDialog
          unit={openUnit}
          ownerName={stop.name}
          nationality={stop.nationality}
          initialNotes={noteOverrides[openUnit.id] ?? openUnit.notes ?? ''}
          canEdit={!!stop.saveNote}
          label={label}
          onSave={async (notes) => {
            await stop.saveNote!(openUnit.id, notes);
            setNoteOverrides(m => ({ ...m, [openUnit.id]: notes }));
          }}
          onClose={() => setOpenUnit(null)}
        />
      )}
    </>
  );
}
