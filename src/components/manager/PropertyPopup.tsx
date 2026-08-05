import React, { useEffect, useMemo, useState } from 'react';
import { useVault } from '../../state/VaultContext';
import { CallStop, CallUnit, OwnerNumbers } from '../../state/CallSessionContext';
import { CallOutcome, CallOutcomeLabel, PropertyState } from '../../types/models';
import type { PhoneEntry } from '../../types/models';
import { StateChip, CountdownBadge, OutcomeChip } from '../common/StateChip';
import { Icon } from '../common/Icon';
import { ApiError } from '../../data/apiClient';
import { sectionLabel, outcomeColor } from '../broker/callVisuals';
import { ownerStopForProperty, stopDeps } from '../broker/callStops';
import { fmtDateTime, timeAgo } from '../../utils/format';
import type { PropertyEvent } from '../../data/api';
import * as api from '../../data/api';

/** Plain-text colour for the rental line by its tone (vacant = opening, etc.). */
const RENTAL_TONE: Record<string, string> = {
  good: 'var(--success)', warn: 'var(--warning)', info: 'var(--text-secondary)', neutral: 'var(--text-secondary)',
};

/**
 * The unit work surface — opened by clicking a unit in a data table (manager
 * Vault / Assignments, and the broker's Database tab).
 *
 * A big, property-centric, THREE-column layout:
 *   • Left   — the record: the owner's property/ies (a scrollable list when they
 *              own several; click one to focus it), the owner, and persistent
 *              notes that stay on the property no matter who it's assigned to.
 *   • Middle — call & log: reveal the number(s), pick an outcome, add call
 *              feedback, Save (logs a real call on the focused unit, moving its
 *              state), then Close / Next property.
 *   • Right  — a full history journal for the focused unit: every call and key
 *              event, newest first.
 *
 * Reveal-lock: once a number is revealed, a result must be saved before the tab
 * can be closed or advanced.
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
  const [loading, setLoading] = useState(true);
  // Which of the owner's units the middle + right + notes act on. Defaults to
  // the clicked unit; the left list switches it for a multi-unit owner.
  const [focusedId, setFocusedId] = useState(propertyId);
  // Live state/deadline for units that changed this session (after a save).
  const [refresh, setRefresh] = useState<Record<string, { state: PropertyState; expiresAt?: string }>>({});

  // Reveal (owner-level — one reveal returns the whole card)
  const [phones, setPhones] = useState<PhoneEntry[]>([]);
  const [revealedOwners, setRevealedOwners] = useState<OwnerNumbers[]>([]);
  const [activeOwner, setActiveOwner] = useState(0);
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [savedSinceReveal, setSavedSinceReveal] = useState(false);

  // Outcome + feedback (for the focused unit)
  const [outcome, setOutcome] = useState<CallOutcome | null>(null);
  const [feedback, setFeedback] = useState('');
  const [followUpAt, setFollowUpAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  // Persistent notes (per unit)
  const [notes, setNotes] = useState('');
  const [noteOverrides, setNoteOverrides] = useState<Record<string, string>>({});
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);

  // History journal (for the focused unit)
  const [events, setEvents] = useState<PropertyEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsKey, setEventsKey] = useState(0);

  // Load the owner's card whenever the clicked unit changes (incl. "Next").
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFocusedId(propertyId); setRefresh({}); setNoteOverrides({});
    setPhones([]); setRevealedOwners([]); setActiveOwner(0); setRevealed(false);
    setSavedSinceReveal(false); setOutcome(null); setFeedback(''); setFollowUpAt('');
    setJustSaved(false); setRevealError(null); setSaveError(null); setNotesSaved(false);
    void (async () => {
      try {
        const p = await api.properties.byId(propertyId);
        const s = await ownerStopForProperty(p, deps);
        if (!cancelled) setStop(s);
      } catch {
        if (!cancelled) setStop(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [propertyId, deps]);

  const focusedUnit: CallUnit | undefined = stop?.units?.find(u => u.id === focusedId);

  // Reset the notes box + per-unit editors whenever the focus changes.
  useEffect(() => {
    setNotes(noteOverrides[focusedId] ?? focusedUnit?.notes ?? '');
    setNotesSaved(false);
    setOutcome(null); setFeedback(''); setFollowUpAt(''); setJustSaved(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedId, stop]);

  // History journal for the focused unit; refetched after a save.
  useEffect(() => {
    let cancelled = false;
    setEventsLoading(true);
    void (async () => {
      try {
        const e = await api.properties.events(focusedId);
        if (!cancelled) setEvents(e);
      } catch {
        if (!cancelled) setEvents([]);
      } finally {
        if (!cancelled) setEventsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [focusedId, eventsKey]);

  const units = stop?.units ?? [];
  const multiUnit = units.length > 1;
  const multiOwner = !!(stop?.owners && stop.owners.length > 1);
  const activePhones = multiOwner ? (revealedOwners[activeOwner]?.phones ?? []) : phones;
  const activeOwnerName = multiOwner ? stop?.owners?.[activeOwner]?.name : undefined;

  const OUTCOMES = Object.values(CallOutcome) as CallOutcome[];
  const isReached = (o: CallOutcome) => o !== CallOutcome.noAnswer && o !== CallOutcome.unreachable;
  const needFeedback = outcome != null && isReached(outcome);
  const isCallback = outcome === CallOutcome.callbackLater;
  const canSave = outcome != null && (!needFeedback || feedback.trim().length > 0) &&
    (!isCallback || !!followUpAt) && !saving;

  const locked = revealed && !savedSinceReveal;
  const nextId = (() => { const i = ids.indexOf(propertyId); return i >= 0 ? ids[i + 1] : undefined; })();

  const curState = refresh[focusedId]?.state ?? focusedUnit?.state ?? PropertyState.pool;
  const curExpires = refresh[focusedId]?.expiresAt ?? focusedUnit?.expiresAt;

  const tryClose = () => { if (locked) return; onClose(); };
  const tryNext = () => { if (locked) return; if (nextId && onNavigate) onNavigate(nextId); };

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
    if (!stop || !canSave) return;
    setSaving(true); setSaveError(null);
    const fu = followUpAt ? new Date(followUpAt).toISOString() : undefined;
    try {
      // Multi-unit owner → log against the FOCUSED unit only; single unit → its own log.
      if (stop.logUnit) await stop.logUnit(focusedId, outcome!, feedback.trim() || undefined, isCallback ? fu : undefined, activeOwnerName);
      else await stop.log(outcome!, feedback.trim() || undefined, isCallback ? fu : undefined, activeOwnerName);
      setSavedSinceReveal(true);
      setJustSaved(true);
      try {
        const p2 = await api.properties.byId(focusedId);
        setRefresh(r => ({ ...r, [focusedId]: { state: p2.state, expiresAt: p2.assignmentExpiresAt } }));
      } catch { /* keep the old chip */ }
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
      await stop.saveNote(focusedId, notes);
      setNoteOverrides(m => ({ ...m, [focusedId]: notes }));
      setNotesSaved(true);
      setEventsKey(k => k + 1);
    } catch { /* ignore */ } finally {
      setNotesSaving(false);
    }
  };

  const ownerBlocks = multiOwner
    ? stop!.owners!.map((o, i) => ({ name: o.name, nationality: o.nationality, nums: revealedOwners[i]?.phones ?? o.phonesMasked ?? [] }))
    : [{ name: stop?.name ?? 'Owner', nationality: stop?.nationality, nums: (revealed ? phones : (stop?.phonesMasked ?? [])) }];

  return (
    <div className="modal-overlay" onClick={tryClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}
        style={{ width: '94vw', maxWidth: 1240, maxHeight: '90vh', display: 'flex', flexDirection: 'column', gap: 14, padding: 20 }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>Loading…</div>
        ) : !stop ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>Property not found.</div>
        ) : (
          <>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
              <div style={{ width: 42, height: 42, borderRadius: '50%', flexShrink: 0, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>{stop.flag}</div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, lineHeight: 1.2 }} className="truncate">{focusedUnit?.label ?? stop.name}</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }} className="truncate">
                  {[stop.name, focusedUnit?.location, stop.nationality].filter(Boolean).join(' · ')}
                </div>
              </div>
              <StateChip state={curState} />
              <CountdownBadge deadline={curExpires} soonHours={vault.settings.expiringSoonHours} />
              <button className="btn btn-icon btn-sm" onClick={tryClose} aria-label="Close"><Icon name="x" size={16} /></button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))', gap: 14, flex: 1, minHeight: 0 }}>
              {/* ── LEFT: the record + persistent notes ─────────────────────── */}
              <Column>
                <div style={sectionLabel}>
                  {multiUnit ? `Properties (${units.length}) — this owner` : 'Property'}
                </div>
                {multiUnit && (
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginBottom: 6 }}>
                    Click a property to view its details, notes and history.
                  </div>
                )}
                {/* Scrollable block — all of the owner's units. */}
                <div style={{ maxHeight: multiUnit ? 300 : undefined, overflowY: multiUnit ? 'auto' : 'visible', display: 'flex', flexDirection: 'column', gap: 8, paddingRight: multiUnit ? 4 : 0 }}>
                  {units.map(u => {
                    const sel = u.id === focusedId;
                    const st = refresh[u.id]?.state ?? u.state;
                    return (
                      <button key={u.id} onClick={() => setFocusedId(u.id)} disabled={!multiUnit}
                        style={{
                          textAlign: 'left', cursor: multiUnit ? 'pointer' : 'default',
                          border: `1.5px solid ${sel ? 'var(--gold)' : 'var(--border)'}`, borderRadius: 10, padding: 12,
                          background: sel ? 'color-mix(in srgb, var(--gold) 9%, transparent)' : 'var(--surface-2)',
                        }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, justifyContent: 'space-between' }}>
                          {/* Full unit number — wraps rather than clipping. */}
                          <span style={{ fontWeight: 700, fontSize: '0.95rem', lineHeight: 1.3, whiteSpace: 'normal', wordBreak: 'break-word' }}>{u.label}</span>
                          <span style={{ flexShrink: 0 }}><StateChip state={st} /></span>
                        </div>
                        {u.location && <div style={{ fontSize: '0.76rem', color: 'var(--text-tertiary)', marginTop: 3, whiteSpace: 'normal', wordBreak: 'break-word' }}>{u.location}</div>}
                        {u.facts.length > 0 && <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: 4, whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: 1.45 }}>{u.facts.join(' · ')}</div>}
                        {u.lastSale && <div style={{ fontSize: '0.76rem', color: 'var(--text-tertiary)', marginTop: 5 }}>Last sale: <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{u.lastSale}</span></div>}
                        {/* Rental status + info as plain text, right below the last sale. */}
                        {u.rental && <div style={{ fontSize: '0.78rem', marginTop: 3, color: RENTAL_TONE[u.rental.tone], fontWeight: 500, whiteSpace: 'normal', wordBreak: 'break-word' }}>Rental: {u.rental.label}</div>}
                        {(noteOverrides[u.id] ?? u.notes) && <div style={{ fontSize: '0.74rem', color: 'var(--gold-dark)', marginTop: 5, display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--gold)' }} /> has notes</div>}
                      </button>
                    );
                  })}
                </div>

                <div style={{ ...sectionLabel, marginTop: 14 }}>{multiOwner ? `Owners (${stop.owners!.length})` : 'Owner'}</div>
                <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, background: 'var(--surface-2)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {ownerBlocks.map((o, i) => (
                    <div key={i}>
                      <div style={{ fontWeight: 600, fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <Icon name="user" size={13} style={{ color: 'var(--text-tertiary)' }} /> {o.name || `Owner ${i + 1}`}
                      </div>
                      {o.nationality && <span style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginLeft: 6 }}>{o.nationality}</span>}
                      <div className="tabular-nums" style={{ fontSize: '0.8rem', marginTop: 2, color: 'var(--text)', display: 'flex', flexWrap: 'wrap', gap: '2px 12px' }}>
                        {o.nums.length > 0 ? o.nums.map((p, j) => <span key={j}>{p.number}</span>) : <span style={{ color: 'var(--text-tertiary)' }}>—</span>}
                      </div>
                    </div>
                  ))}
                </div>

                <div style={{ ...sectionLabel, marginTop: 14 }}>Notes {multiUnit ? `on ${focusedUnit?.label ?? 'this unit'}` : 'on this property'}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginBottom: 6 }}>
                  Stays on the property — kept even if it's reassigned or returns to the pool.
                </div>
                <textarea className="input" value={notes} rows={4} style={{ resize: 'vertical' }}
                  placeholder="Anything worth keeping on this unit permanently…"
                  onChange={e => { setNotes(e.target.value); setNotesSaved(false); }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                  <button className="btn btn-sm" onClick={saveNotes} disabled={notesSaving || !stop.saveNote}>{notesSaving ? 'Saving…' : 'Save notes'}</button>
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
                        const sel = i === activeOwner; const n = o.phonesMasked?.length ?? 0;
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

                <div style={{ ...sectionLabel, marginTop: 14 }}>
                  Log the outcome{multiUnit ? ` — ${focusedUnit?.label ?? ''}` : ''}
                </div>
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
                  <button className="btn btn-primary" onClick={save} disabled={!canSave}
                    style={{ marginTop: 8, width: '100%', justifyContent: 'center', padding: '10px', background: 'var(--gold)', borderColor: 'var(--gold)', color: '#2A2013', opacity: canSave ? 1 : 0.5 }}>
                    <Icon name="check" size={16} /> {saving ? 'Saving…' : 'Save to record'}
                  </button>
                )}
                {justSaved && <div style={{ color: 'var(--success)', fontSize: '0.8rem', marginTop: 6, fontWeight: 600 }}>✓ Call logged to the record.</div>}
                {saveError && <ErrorBox>{saveError}</ErrorBox>}

                <div style={{ marginTop: 'auto', paddingTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="btn" onClick={tryClose} disabled={locked} style={{ opacity: locked ? 0.5 : 1 }}>Close</button>
                  <button className="btn btn-primary" onClick={tryNext} disabled={locked || !nextId} style={{ opacity: (locked || !nextId) ? 0.5 : 1 }}>
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
                <div style={sectionLabel}>History journal{multiUnit ? ` — ${focusedUnit?.label ?? ''}` : ''}</div>
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

function Column({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflowY: 'auto', paddingRight: 4 }}>{children}</div>;
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 8, fontSize: '0.8rem', background: 'color-mix(in srgb, var(--error) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--error) 45%, transparent)', color: 'var(--error)' }}>{children}</div>
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
          <span style={{ fontWeight: 600, fontSize: '0.82rem' }}>
            {e.kind === 'call' ? (e.ownerName ? `Call · ${e.ownerName}` : 'Call') : e.detail}
          </span>
          {/* Which of the owner's units the call was about — so a note left on
              another unit is clearly attributed. */}
          {e.kind === 'call' && e.unitLabel && (
            <span className="chip" style={{
              fontSize: '0.68rem', padding: '1px 7px',
              background: e.thisUnit ? 'color-mix(in srgb, var(--gold) 16%, transparent)' : 'var(--surface-2)',
              color: e.thisUnit ? 'var(--gold-dark)' : 'var(--text-secondary)',
              fontWeight: 600, border: '1px solid var(--border-light)',
            }}>{e.unitLabel}</span>
          )}
        </div>
        {e.kind === 'call' && e.note && <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: 2 }}>“{e.note}”</div>}
        <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginTop: 2 }}>
          {[who, fmtDateTime(e.at), timeAgo(e.at)].filter(Boolean).join(' · ')}
        </div>
      </div>
    </div>
  );
}
