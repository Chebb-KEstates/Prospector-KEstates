import React, { useEffect, useMemo, useState } from 'react';
import { useVault } from '../../state/VaultContext';
import { CallStop, CallUnit, OwnerNumbers } from '../../state/CallSessionContext';
import { CallOutcome, CallOutcomeLabel } from '../../types/models';
import type { PhoneEntry, Property } from '../../types/models';
import { StateChip, CountdownBadge, OutcomeChip } from '../common/StateChip';
import { Icon } from '../common/Icon';
import { ApiError } from '../../data/apiClient';
import { ToneChip, sectionLabel, outcomeColor } from '../broker/callVisuals';
import { ownerStopForProperty, stopDeps } from '../broker/callStops';
import { splitOwnerNames, fmtDateTime, timeAgo } from '../../utils/format';
import type { PropertyEvent } from '../../data/api';
import * as api from '../../data/api';

/**
 * The unit work surface — opened by clicking a unit in a data table.
 *
 * A big, property-centric, THREE-column layout:
 *   • Left   — the record: property + owner information, and persistent notes
 *              that stay on the property no matter who it's assigned to.
 *   • Middle — call & log: reveal the number(s), pick an outcome, add call
 *              feedback, Save (logs a real call, moves the record's state), then
 *              Close / Next property.
 *   • Right  — a full history journal: every call and key event, newest first.
 *
 * Reveal-lock: once a number is revealed, a result must be saved before the tab
 * can be closed or advanced — the reveal is only worth it if it's recorded.
 */
export function PropertyPopup({ propertyId, ids = [], onNavigate, onClose }: {
  propertyId: string;
  /** Ordered unit ids from the table's current page — drives "Next property". */
  ids?: string[];
  /** Open another unit (the parent records the audited view). */
  onNavigate?: (id: string) => void;
  onClose: () => void;
}) {
  const vault = useVault();
  const deps = useMemo(
    () => stopDeps(vault.users, vault.logCall, vault.logLeadCall),
    [vault.users, vault.logCall, vault.logLeadCall],
  );

  const [stop, setStop] = useState<CallStop | null>(null);
  const [prop, setProp] = useState<Property | null>(null);
  const [loading, setLoading] = useState(true);

  // Reveal
  const [phones, setPhones] = useState<PhoneEntry[]>([]);
  const [revealedOwners, setRevealedOwners] = useState<OwnerNumbers[]>([]);
  const [activeOwner, setActiveOwner] = useState(0);
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  // The reveal-lock: a number was revealed and no result saved for it yet.
  const [savedSinceReveal, setSavedSinceReveal] = useState(false);

  // Outcome + feedback
  const [outcome, setOutcome] = useState<CallOutcome | null>(null);
  const [feedback, setFeedback] = useState('');
  const [followUpAt, setFollowUpAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  // Persistent notes (stay on the property)
  const [notes, setNotes] = useState('');
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);

  // History journal
  const [events, setEvents] = useState<PropertyEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsKey, setEventsKey] = useState(0);

  // Reset per-unit state whenever the focused unit changes (incl. "Next").
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPhones([]); setRevealedOwners([]); setActiveOwner(0); setRevealed(false);
    setSavedSinceReveal(false); setOutcome(null); setFeedback(''); setFollowUpAt('');
    setJustSaved(false); setRevealError(null); setSaveError(null);
    setNotesSaved(false);
    void (async () => {
      try {
        const p = await api.properties.byId(propertyId);
        const s = await ownerStopForProperty(p, deps);
        if (!cancelled) { setProp(p); setStop(s); setNotes(p.notes ?? ''); }
      } catch {
        if (!cancelled) { setProp(null); setStop(null); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [propertyId, deps]);

  // History journal — refetched after a save (eventsKey bump).
  useEffect(() => {
    let cancelled = false;
    setEventsLoading(true);
    void (async () => {
      try {
        const e = await api.properties.events(propertyId);
        if (!cancelled) setEvents(e);
      } catch {
        if (!cancelled) setEvents([]);
      } finally {
        if (!cancelled) setEventsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [propertyId, eventsKey]);

  // The unit's rich facts (beds/type/size/rental/last sale) — computed once by
  // the shared stop builder; find THIS unit within the owner's set.
  const unit: CallUnit | undefined = stop?.units?.find(u => u.id === propertyId);
  const multiOwner = !!(stop?.owners && stop.owners.length > 1);
  const activePhones = multiOwner ? (revealedOwners[activeOwner]?.phones ?? []) : phones;
  const activeOwnerName = multiOwner ? stop?.owners?.[activeOwner]?.name : undefined;
  const ownerNames = multiOwner ? stop!.owners!.map(o => o.name) : splitOwnerNames(stop?.name ?? '');

  const OUTCOMES = Object.values(CallOutcome) as CallOutcome[];
  const isReached = (o: CallOutcome) => o !== CallOutcome.noAnswer && o !== CallOutcome.unreachable;
  const needFeedback = outcome != null && isReached(outcome);
  const isCallback = outcome === CallOutcome.callbackLater;
  const canSave = outcome != null && (!needFeedback || feedback.trim().length > 0) &&
    (!isCallback || !!followUpAt) && !saving;

  const locked = revealed && !savedSinceReveal;
  const nextId = (() => { const i = ids.indexOf(propertyId); return i >= 0 ? ids[i + 1] : undefined; })();

  const tryClose = () => { if (locked) return; onClose(); };
  const tryNext = () => {
    if (locked) return;
    if (nextId && onNavigate) onNavigate(nextId);
  };

  const doReveal = async () => {
    if (!stop || revealing) return;
    setRevealing(true); setRevealError(null);
    try {
      const r = await stop.reveal();
      setPhones(r.phones); setRevealedOwners(r.owners);
      setRevealed(true); setSavedSinceReveal(false);
    } catch (e) {
      setRevealError(e instanceof ApiError ? e.message : 'Could not fetch the number.');
    } finally {
      setRevealing(false);
    }
  };

  const save = async () => {
    if (!prop || !canSave) return;
    setSaving(true); setSaveError(null);
    const fu = followUpAt ? new Date(followUpAt).toISOString() : undefined;
    try {
      await vault.logCall([prop], outcome!, feedback.trim() || undefined, isCallback ? fu : undefined, activeOwnerName);
      setSavedSinceReveal(true);
      setJustSaved(true);
      // Refresh the record's state chip and the journal.
      try { const p2 = await api.properties.byId(propertyId); setProp(p2); } catch { /* keep old */ }
      setEventsKey(k => k + 1);
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : 'Could not save that. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const saveNotes = async () => {
    if (!stop?.saveNote) return;
    setNotesSaving(true);
    try {
      await stop.saveNote(propertyId, notes);
      setNotesSaved(true);
      setEventsKey(k => k + 1);
    } catch { /* surfaced by disabling save briefly */ } finally {
      setNotesSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={tryClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}
        style={{ width: '92vw', maxWidth: 1180, maxHeight: '88vh', display: 'flex', flexDirection: 'column', gap: 14, padding: 20 }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>Loading…</div>
        ) : !stop || !prop ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>Property not found.</div>
        ) : (
          <>
            {/* Header — spans all three columns */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
              <div style={{ width: 42, height: 42, borderRadius: '50%', flexShrink: 0, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>{stop.flag}</div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, lineHeight: 1.2 }} className="truncate">{unit?.label ?? stop.name}</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }} className="truncate">
                  {[stop.name, unit?.location, stop.nationality].filter(Boolean).join(' · ')}
                </div>
              </div>
              <StateChip state={prop.state} />
              <CountdownBadge deadline={prop.assignmentExpiresAt} soonHours={vault.settings.expiringSoonHours} />
              <button className="btn btn-icon btn-sm" onClick={tryClose} aria-label="Close"><Icon name="x" size={16} /></button>
            </div>

            {/* Three columns */}
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
              gap: 14, flex: 1, minHeight: 0,
            }}>
              {/* ── LEFT: the record + persistent notes ─────────────────────── */}
              <Column>
                <div style={sectionLabel}>Property</div>
                <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, background: 'var(--surface-2)' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{unit?.label ?? '—'}</div>
                  {unit?.location && <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginTop: 1 }}>{unit.location}</div>}
                  {unit?.facts && unit.facts.length > 0 && (
                    <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: 6 }}>{unit.facts.join(' · ')}</div>
                  )}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                    {unit?.rental && <ToneChip tone={unit.rental.tone}>{unit.rental.label}</ToneChip>}
                    {stop.signals?.map((s, i) => <ToneChip key={i} tone={s.tone}>{s.label}</ToneChip>)}
                  </div>
                  {unit?.lastSale && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border-light)' }}>
                      Last sale: <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{unit.lastSale}</span>
                    </div>
                  )}
                </div>

                <div style={{ ...sectionLabel, marginTop: 14 }}>
                  {multiOwner ? `Owners (${ownerNames.length})` : 'Owner'}
                </div>
                <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, background: 'var(--surface-2)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {(multiOwner ? stop.owners! : [{ name: stop.name, nationality: stop.nationality }]).map((o, i) => {
                    const real = multiOwner ? revealedOwners[i]?.phones : (revealed ? phones : undefined);
                    const masked = multiOwner ? stop.owners![i]?.phonesMasked : prop.owner.allPhones;
                    const nums = real ?? masked ?? [];
                    return (
                      <div key={i}>
                        <div style={{ fontWeight: 600, fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                          <Icon name="user" size={13} style={{ color: 'var(--text-tertiary)' }} /> {o.name || `Owner ${i + 1}`}
                        </div>
                        {o.nationality && <span style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginLeft: 6 }}>{o.nationality}</span>}
                        <div className="tabular-nums" style={{ fontSize: '0.8rem', marginTop: 2, color: real ? 'var(--text)' : 'var(--text-tertiary)', fontWeight: real ? 600 : 400, display: 'flex', flexWrap: 'wrap', gap: '2px 12px' }}>
                          {nums.length > 0 ? nums.map((p, j) => <span key={j}>{p.number}</span>) : <span>—</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div style={{ ...sectionLabel, marginTop: 14 }}>Notes on this property</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginBottom: 6 }}>
                  Stays on the property — kept even if it's reassigned or returns to the pool.
                </div>
                <textarea className="input" value={notes} rows={5} style={{ resize: 'vertical' }}
                  placeholder="Anything worth keeping on this unit permanently…"
                  onChange={e => { setNotes(e.target.value); setNotesSaved(false); }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                  <button className="btn btn-sm" onClick={saveNotes} disabled={notesSaving || !stop.saveNote}>
                    {notesSaving ? 'Saving…' : 'Save notes'}
                  </button>
                  {notesSaved && <span style={{ color: 'var(--success)', fontSize: '0.78rem' }}>Saved ✓</span>}
                </div>
              </Column>

              {/* ── MIDDLE: call & log ──────────────────────────────────────── */}
              <Column>
                <div style={sectionLabel}>Call</div>
                {multiOwner && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginBottom: 4 }}>Who are you calling?</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {stop.owners!.map((o, i) => {
                        const sel = i === activeOwner;
                        const n = o.phonesMasked?.length ?? 0;
                        return (
                          <button key={i} className="btn btn-sm" onClick={() => setActiveOwner(i)}
                            style={{ borderColor: sel ? 'var(--gold)' : 'var(--border)', borderWidth: sel ? 1.5 : 1, background: sel ? 'color-mix(in srgb, var(--gold) 14%, transparent)' : 'var(--surface)', color: sel ? 'var(--gold-dark)' : 'var(--text)', fontWeight: sel ? 600 : 500 }}>
                            <Icon name="user" size={12} /> {o.name || `Owner ${i + 1}`}{n > 1 ? ` · ${n}` : ''}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {!revealed ? (
                  <div>
                    <button className="btn btn-primary" onClick={doReveal} disabled={revealing || !stop.phoneMasked}
                      style={{ width: '100%', justifyContent: 'center', padding: '11px' }}>
                      <Icon name="phoneCall" size={17} /> {revealing ? 'Fetching number…' : (stop.phoneMasked ? 'Call — reveal number' : 'No number on file')}
                    </button>
                    {revealError && <ErrorBox>{revealError}</ErrorBox>}
                  </div>
                ) : activePhones.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {multiOwner && <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>{activeOwnerName} · {activePhones.length} number{activePhones.length === 1 ? '' : 's'}</div>}
                    {activePhones.map((ph, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 10, background: 'color-mix(in srgb, var(--gold) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--gold) 45%, transparent)' }}>
                        {activePhones.length > 1 && <span className="chip" style={{ background: 'var(--surface)', color: 'var(--gold-dark)', fontWeight: 700, flexShrink: 0 }}>{ph.label}</span>}
                        <span className="tabular-nums" style={{ flex: 1, fontSize: '1.05rem', fontWeight: 700, letterSpacing: '0.5px', userSelect: 'all' }}>{ph.number}</span>
                        <button className="btn btn-ghost btn-sm" onClick={() => navigator.clipboard?.writeText(ph.number)}><Icon name="copy" size={14} /></button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ padding: '8px 12px', borderRadius: 10, fontSize: '0.8rem', color: 'var(--text-tertiary)', background: 'var(--surface-2)', border: '1px solid var(--border)' }}>No number on file.</div>
                )}

                {/* Outcome + feedback */}
                <div style={{ ...sectionLabel, marginTop: 14 }}>Log the outcome</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {OUTCOMES.map(o => {
                    const c = outcomeColor(o); const sel = outcome === o;
                    return (
                      <button key={o} className="btn btn-sm" onClick={() => { setOutcome(o); setJustSaved(false); }}
                        style={{ borderColor: sel ? c : 'var(--border)', borderWidth: sel ? 1.5 : 1, color: sel ? c : 'var(--text)', background: sel ? `color-mix(in srgb, ${c} 16%, transparent)` : 'var(--surface)', fontWeight: sel ? 600 : 500 }}>
                        {CallOutcomeLabel[o]}
                      </button>
                    );
                  })}
                </div>

                {isCallback && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Call back on</span>
                    <input className="input" type="date" value={followUpAt} onChange={e => setFollowUpAt(e.target.value)} style={{ width: 170 }} />
                  </div>
                )}

                <textarea className="input" value={feedback} rows={3} style={{ resize: 'vertical', marginTop: 8 }}
                  placeholder={needFeedback ? 'Call feedback — what was said… (required)' : 'Call feedback — what was said…'}
                  onChange={e => { setFeedback(e.target.value); setJustSaved(false); }} />

                {outcome != null && (
                  <button className="btn btn-primary" onClick={save} disabled={!canSave} style={{ marginTop: 8, width: '100%', justifyContent: 'center', padding: '10px', background: 'var(--gold)', borderColor: 'var(--gold)', color: '#2A2013', opacity: canSave ? 1 : 0.5 }}>
                    <Icon name="check" size={16} /> {saving ? 'Saving…' : 'Save to record'}
                  </button>
                )}
                {justSaved && <div style={{ color: 'var(--success)', fontSize: '0.8rem', marginTop: 6, fontWeight: 600 }}>✓ Call logged to the record.</div>}
                {saveError && <ErrorBox>{saveError}</ErrorBox>}

                {/* Close / Next — guarded by the reveal-lock */}
                <div style={{ marginTop: 'auto', paddingTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="btn" onClick={tryClose} disabled={locked} style={{ opacity: locked ? 0.5 : 1 }}>Close</button>
                  <button className="btn btn-primary" onClick={tryNext} disabled={locked || !nextId}
                    style={{ opacity: (locked || !nextId) ? 0.5 : 1 }}>
                    Next property <Icon name="arrowRight" size={15} />
                  </button>
                </div>
                {locked && (
                  <div style={{ fontSize: '0.72rem', color: 'var(--gold-dark)', display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                    <Icon name="alert" size={13} /> Log a result to finish — the number is only worth revealing if it's recorded.
                  </div>
                )}
              </Column>

              {/* ── RIGHT: history journal ──────────────────────────────────── */}
              <Column>
                <div style={sectionLabel}>History journal</div>
                {eventsLoading && events.length === 0 ? (
                  <div style={{ color: 'var(--text-tertiary)', fontSize: '0.82rem', padding: 8 }}>Loading…</div>
                ) : events.length === 0 ? (
                  <div style={{ color: 'var(--text-tertiary)', fontSize: '0.82rem', padding: '8px 10px', borderRadius: 8, background: 'var(--surface-2)', border: '1px solid var(--border-light)' }}>
                    No history yet — this is a fresh record.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {events.map((e, i) => <JournalRow key={i} e={e} actorName={id => vault.userById(id)?.name} />)}
                  </div>
                )}
              </Column>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** A scroll-independent column. */
function Column({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflowY: 'auto', paddingRight: 4 }}>
      {children}
    </div>
  );
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 8, fontSize: '0.8rem', background: 'color-mix(in srgb, var(--error) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--error) 45%, transparent)', color: 'var(--error)' }}>
      {children}
    </div>
  );
}

/** One entry in the history journal: a call, a record event, or the import. */
function JournalRow({ e, actorName }: { e: PropertyEvent; actorName: (id: string) => string | undefined }) {
  const icon = e.kind === 'call' ? 'phoneCall'
    : e.kind === 'import' ? 'upload'
      : e.action === 'view' ? 'eye'
        : e.action === 'assign' ? 'assign'
          : e.action === 'reclaim' ? 'refresh'
            : 'clock';
  const who = e.kind === 'import' ? undefined : actorName(e.actorId ?? '') ?? undefined;
  return (
    <div style={{ display: 'flex', gap: 10, paddingBottom: 10, borderBottom: '1px solid var(--border-light)' }}>
      <div style={{ width: 26, height: 26, borderRadius: '50%', flexShrink: 0, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)' }}>
        <Icon name={icon as any} size={14} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {e.kind === 'call' && <OutcomeChip outcome={e.outcome} />}
          <span style={{ fontWeight: 600, fontSize: '0.8rem' }}>
            {e.kind === 'call' ? (e.ownerName ? `Call · ${e.ownerName}` : 'Call') : e.kind === 'import' ? e.detail : e.detail}
          </span>
        </div>
        {e.kind === 'call' && e.note && <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 2 }}>“{e.note}”</div>}
        <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', marginTop: 2 }}>
          {[who, fmtDateTime(e.at), timeAgo(e.at)].filter(Boolean).join(' · ')}
        </div>
      </div>
    </div>
  );
}
