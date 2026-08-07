import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useVault } from '../../state/VaultContext';
import { CallStop, CallUnit, OwnerNumbers } from '../../state/CallSessionContext';
import { CallOutcome, PropertyState } from '../../types/models';
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

/** Each of the left column's little info boxes shares this shell + label style. */
const boxStyle: React.CSSProperties = {
  border: '1px solid var(--border)', borderRadius: 12, padding: 14, background: 'var(--surface-2)',
};
const boxTitle: React.CSSProperties = {
  fontSize: '0.64rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)', fontWeight: 600,
};

/**
 * The call outcome is captured in two parts:
 *   1. did the call connect — No answer / Didn't connect / Answered;
 *   2. if Answered, one or more results.
 *
 * Each result maps to a disposition the timer engine already understands (the
 * new labels reuse an existing behaviour), so nothing about the state machine or
 * the database changes. When several are picked, the STRONGEST one (highest in
 * OUTCOME_PRIORITY) drives the state; every label the broker ticked is written
 * into the call's feedback so it's kept on the record.
 */
type Connection = 'answered' | 'noAnswer' | 'unreachable';
interface ResultOption { key: string; label: string; outcome: CallOutcome }
const RESULT_OPTIONS: ResultOption[] = [
  { key: 'sell', label: 'Interested — sell', outcome: CallOutcome.interestedSell },
  { key: 'rent', label: 'Interested — rent', outcome: CallOutcome.interestedRent },
  { key: 'callback', label: 'Call back later', outcome: CallOutcome.callbackLater },
  { key: 'future', label: 'Possible future interest', outcome: CallOutcome.callbackLater },
  { key: 'notInterested', label: 'Not interested', outcome: CallOutcome.notInterested },
  { key: 'living', label: 'Living in property', outcome: CallOutcome.notInterested },
  { key: 'dropped', label: 'Dropped call', outcome: CallOutcome.noAnswer },
  { key: 'dnc', label: 'Do not call', outcome: CallOutcome.dnc },
];
const OUTCOME_PRIORITY: CallOutcome[] = [
  CallOutcome.dnc, CallOutcome.interestedSell, CallOutcome.interestedRent,
  CallOutcome.callbackLater, CallOutcome.notInterested, CallOutcome.unreachable, CallOutcome.noAnswer,
];
function strongestOutcome(rs: ResultOption[]): CallOutcome | null {
  for (const o of OUTCOME_PRIORITY) if (rs.some(r => r.outcome === o)) return o;
  return null;
}

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

  // Outcome + feedback (for the focused unit). Two-part: did the call connect
  // (section 1), and — if answered — one or more results (section 2).
  const [connection, setConnection] = useState<Connection | null>(null);
  const [results, setResults] = useState<Set<string>>(new Set());
  const [feedback, setFeedback] = useState('');
  const [followUpAt, setFollowUpAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  // Persistent notes (per unit) — auto-saved on close / next / after a call log.
  const [notes, setNotes] = useState('');
  const [noteOverrides, setNoteOverrides] = useState<Record<string, string>>({});
  const [notesDirty, setNotesDirty] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);

  // "Next property": next in the table order, or a random one when ticked.
  const [randomize, setRandomize] = useState(() => localStorage.getItem('prospector.popup.randomizeNext') === '1');

  // A running tally of THIS popup session — like the dialer's progress bar.
  // Survives Next/Previous (the component isn't remounted on navigation).
  const [session, setSession] = useState({ made: 0, answered: 0, noAnswer: 0, interested: 0 });

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
    setSavedSinceReveal(false); setConnection(null); setResults(new Set()); setFeedback(''); setFollowUpAt('');
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
    setNotesSaved(false); setNotesDirty(false);
    setConnection(null); setResults(new Set()); setFeedback(''); setFollowUpAt(''); setJustSaved(false);
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

  const answered = connection === 'answered';
  const selectedResults = RESULT_OPTIONS.filter(r => results.has(r.key));
  // The single disposition the state machine acts on.
  const primary: CallOutcome | null =
    connection === 'noAnswer' ? CallOutcome.noAnswer
      : connection === 'unreachable' ? CallOutcome.unreachable
        : answered ? strongestOutcome(selectedResults) : null;
  const primaryIsCallback = primary === CallOutcome.callbackLater;
  const needFeedback = answered;                   // an answered call must be explained
  const canSave = primary != null
    && (!answered || selectedResults.length > 0)   // answered ⇒ at least one result
    && (!needFeedback || feedback.trim().length > 0)
    && (!primaryIsCallback || !!followUpAt)
    && !saving;

  const locked = revealed && !savedSinceReveal;
  const listIndex = ids.indexOf(propertyId);
  const total = ids.length;
  const seqNextId = listIndex >= 0 ? ids[listIndex + 1] : undefined;
  const prevId = listIndex > 0 ? ids[listIndex - 1] : undefined;
  const hasNext = randomize ? total > 1 : !!seqNextId;
  const hasPrev = !!prevId;
  const pickNext = () => {
    if (!randomize) return seqNextId;
    const pool = ids.filter(id => id !== propertyId);
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : undefined;
  };

  const curState = refresh[focusedId]?.state ?? focusedUnit?.state ?? PropertyState.pool;
  const curExpires = refresh[focusedId]?.expiresAt ?? focusedUnit?.expiresAt;

  // Structured detail for the focused unit's boxes.
  const detail = focusedUnit?.detail;
  const factsLine = (focusedUnit?.facts ?? []).join(' · ');
  const sale = detail?.sale ?? null;
  const saleLine = sale ? [sale.value, sale.date, sale.type].filter(Boolean).join(' · ') : '';
  const rental = detail?.rental ?? { status: '', tone: 'neutral' as const, endsInDays: null as number | null };
  const rentalPeriod = [rental.start, rental.end].filter(Boolean).join(' → ');
  const rentalWarn = rental.status === 'Rented' && rental.endsInDays != null && rental.endsInDays >= 0 && rental.endsInDays <= 100;

  // Persistent notes save themselves — no button. Flush before leaving the unit.
  const flushNotes = async () => {
    if (!stop?.saveNote || !notesDirty) return;
    try {
      await stop.saveNote(focusedId, notes);
      setNoteOverrides(m => ({ ...m, [focusedId]: notes }));
      setNotesDirty(false); setNotesSaved(true);
      setEventsKey(k => k + 1);
    } catch { /* keep the text; a later close retries */ }
  };

  const tryClose = async () => { if (locked) return; await flushNotes(); onClose(); };
  const tryNext = async () => {
    if (locked) return;
    await flushNotes();
    const n = pickNext();
    if (n && onNavigate) onNavigate(n);
  };
  const tryPrev = async () => {
    if (locked || !prevId) return;
    await flushNotes();
    if (onNavigate) onNavigate(prevId);
  };

  // ← / → flip between property tabs (like the dialer). A ref keeps the handler
  // pointed at the latest closures without re-binding the listener each render.
  const navRef = useRef({ next: tryNext, prev: tryPrev, locked });
  navRef.current = { next: tryNext, prev: tryPrev, locked };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (navRef.current.locked) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); void navRef.current.next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); void navRef.current.prev(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const toggleRandomize = (on: boolean) => {
    setRandomize(on);
    localStorage.setItem('prospector.popup.randomizeNext', on ? '1' : '0');
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
    if (!stop || !canSave) return;
    setSaving(true); setSaveError(null);
    const fu = followUpAt ? new Date(followUpAt).toISOString() : undefined;
    try {
      // Multi-unit owner → log against the FOCUSED unit only; single unit → its own log.
      // Keep every result the broker ticked on the record, even though the
      // state machine only acts on the strongest (`primary`).
      const tags = answered ? selectedResults.map(r => r.label) : [];
      const note = tags.length
        ? `[${tags.join(' · ')}]${feedback.trim() ? ' ' + feedback.trim() : ''}`
        : (feedback.trim() || undefined);
      if (stop.logUnit) await stop.logUnit(focusedId, primary!, note, primaryIsCallback ? fu : undefined, activeOwnerName);
      else await stop.log(primary!, note, primaryIsCallback ? fu : undefined, activeOwnerName);
      setSavedSinceReveal(true);
      setJustSaved(true);
      // Feed the popup-session progress bar.
      setSession(s => ({
        made: s.made + 1,
        answered: s.answered + (connection === 'answered' ? 1 : 0),
        noAnswer: s.noAnswer + (connection === 'noAnswer' || connection === 'unreachable' ? 1 : 0),
        interested: s.interested + (selectedResults.some(r =>
          r.outcome === CallOutcome.interestedSell || r.outcome === CallOutcome.interestedRent) ? 1 : 0),
      }));
      try {
        const p2 = await api.properties.byId(focusedId);
        setRefresh(r => ({ ...r, [focusedId]: { state: p2.state, expiresAt: p2.assignmentExpiresAt } }));
      } catch { /* keep the old chip */ }
      setEventsKey(k => k + 1);
      await flushNotes(); // logging a call also persists any pending notes
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : 'Could not save that. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const ownerBlocks = multiOwner
    ? stop!.owners!.map((o, i) => ({ name: o.name, nationality: o.nationality, nums: revealedOwners[i]?.phones ?? o.phonesMasked ?? [] }))
    : [{ name: stop?.name ?? 'Owner', nationality: stop?.nationality, nums: (revealed ? phones : (stop?.phonesMasked ?? [])) }];

  return (
    <div className="modal-overlay" onClick={() => void tryClose()}>
      <div className="modal-content" onClick={e => e.stopPropagation()}
        style={{ width: '94vw', maxWidth: 1240, height: '90vh', display: 'flex', flexDirection: 'column', gap: 14, padding: 20 }}>
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
                {/* Unit + address only — the owner name lives in the Owner box below. */}
                <div style={{ fontSize: '1.1rem', fontWeight: 700, lineHeight: 1.2 }} className="truncate">{focusedUnit?.label ?? stop.name}</div>
                {focusedUnit?.location && (
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }} className="truncate">{focusedUnit.location}</div>
                )}
              </div>
              <LastCallPill at={focusedUnit?.detail?.lastCalledAt} />
              <StateChip state={curState} />
              <CountdownBadge deadline={curExpires} soonHours={vault.settings.expiringSoonHours} />
              <button className="btn btn-icon btn-sm" onClick={() => void tryClose()} aria-label="Close"><Icon name="x" size={16} /></button>
            </div>

            {/* Progress bar for this run through the list — like the dialer's. */}
            {total > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexShrink: 0, flexWrap: 'wrap', padding: '8px 14px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    Property {listIndex + 1} of {total} · {Math.max(0, total - session.made)} pending
                  </div>
                  <div style={{ marginTop: 5, height: 5, borderRadius: 999, background: 'var(--surface)', overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(100, (session.made / total) * 100)}%`, height: '100%', background: 'var(--gold)', transition: 'width .3s' }} />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  <ProgressStat n={session.made} label="made" />
                  <ProgressStat n={session.answered} label="answered" color="var(--info)" />
                  <ProgressStat n={session.noAnswer} label="no answer" color="var(--warning)" />
                  <ProgressStat n={session.made > 0 ? Math.round((session.answered / session.made) * 100) : 0} suffix="%" label="answer rate" />
                </div>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))', gap: 14, flex: 1, minHeight: 0 }}>
              {/* ── LEFT: the record + persistent notes ─────────────────────── */}
              <Column>
                {/* Multi-unit owner: a compact switcher; the detail boxes below
                    always describe the focused unit. */}
                {multiUnit && (
                  <>
                    <div style={sectionLabel}>Properties ({units.length}) — this owner</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginBottom: 6 }}>Click a property to view its details.</div>
                    <div style={{ maxHeight: 150, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14, paddingRight: 4 }}>
                      {units.map(u => {
                        const sel = u.id === focusedId;
                        const st = refresh[u.id]?.state ?? u.state;
                        return (
                          <button key={u.id} onClick={() => setFocusedId(u.id)}
                            style={{
                              textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between',
                              border: `1.5px solid ${sel ? 'var(--gold)' : 'var(--border)'}`, borderRadius: 10, padding: '8px 10px',
                              background: sel ? 'color-mix(in srgb, var(--gold) 9%, transparent)' : 'var(--surface-2)',
                            }}>
                            <span style={{ fontWeight: 600, fontSize: '0.85rem', whiteSpace: 'normal', wordBreak: 'break-word' }}>{u.label}</span>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                              {(noteOverrides[u.id] ?? u.notes) && <span title="has notes" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--gold)' }} />}
                              <StateChip state={st} />
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}

                {/* One compact box: property facts + last sale + rental together. */}
                <div style={boxStyle}>
                  <div style={{ fontSize: '0.95rem', fontWeight: 700, lineHeight: 1.3, whiteSpace: 'normal', wordBreak: 'break-word' }}>{focusedUnit?.label}</div>
                  {focusedUnit?.location && <div style={{ fontSize: '0.74rem', color: 'var(--text-tertiary)', marginTop: 2 }}>{focusedUnit.location}</div>}
                  <div style={{ fontSize: '0.82rem', color: factsLine ? 'var(--text-secondary)' : 'var(--text-tertiary)', marginTop: 8, lineHeight: 1.5, whiteSpace: 'normal', wordBreak: 'break-word' }}>
                    {factsLine || 'No property details on file.'}
                  </div>

                  <div style={{ borderTop: '1px solid var(--border-light)', marginTop: 12, paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 9 }}>
                    {/* Last sale */}
                    <div style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
                      <span style={{ ...boxTitle, width: 56, flexShrink: 0 }}>Last sale</span>
                      {saleLine
                        ? <span style={{ fontSize: '0.82rem', fontWeight: 500, whiteSpace: 'normal', wordBreak: 'break-word' }}>{saleLine}</span>
                        : <span style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>No sale transaction data.</span>}
                    </div>
                    {/* Rental — gains a red border + glow when the lease ends within 100 days. */}
                    <div style={rentalWarn
                      ? { border: '1px solid var(--error)', borderRadius: 8, padding: '7px 9px', boxShadow: '0 0 0 3px color-mix(in srgb, var(--error) 18%, transparent)' }
                      : undefined}>
                      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                        <span style={{ ...boxTitle, width: 56, flexShrink: 0, paddingTop: 1 }}>Rental</span>
                        {rental.status
                          ? <div style={{ fontSize: '0.82rem', whiteSpace: 'normal', wordBreak: 'break-word' }}>
                            {/* Line 1: status + price. Line 2: the lease period. */}
                            <div>
                              <span style={{ fontWeight: 700, color: RENTAL_TONE[rental.tone] }}>{rental.status}</span>
                              {rental.amount && <span style={{ color: 'var(--text-secondary)' }}> · {rental.amount}</span>}
                            </div>
                            {rentalPeriod && <div style={{ color: 'var(--text-secondary)', marginTop: 1 }}>{rentalPeriod}</div>}
                          </div>
                          : <span style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>No rental transaction data.</span>}
                      </div>
                      {rentalWarn && (
                        <div style={{ fontSize: '0.74rem', color: 'var(--error)', fontWeight: 700, marginTop: 4, marginLeft: 68 }}>
                          ⚠ Lease ends in {rental.endsInDays} day{rental.endsInDays === 1 ? '' : 's'}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* OWNER box */}
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

                {/* NOTES — auto-saved (no button). */}
                <div style={{ ...sectionLabel, marginTop: 14 }}>Notes {multiUnit ? `on ${focusedUnit?.label ?? 'this unit'}` : 'on this property'}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginBottom: 6, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span>Stays on the property — saved automatically when you close, move on, or log a call.</span>
                  {notesSaved && !notesDirty && <span style={{ color: 'var(--success)', fontWeight: 600, whiteSpace: 'nowrap' }}>Saved ✓</span>}
                </div>
                <textarea className="input" value={notes} rows={4} style={{ resize: 'vertical' }}
                  placeholder="Anything worth keeping on this unit permanently…"
                  onChange={e => { setNotes(e.target.value); setNotesDirty(true); setNotesSaved(false); }} />
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

                {/* Section 1 — did the call connect? */}
                <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginBottom: 5 }}>Did the call connect?</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {([['answered', 'Answered'], ['noAnswer', 'No answer'], ['unreachable', 'Call didn’t connect']] as [Connection, string][]).map(([key, label]) => {
                    const sel = connection === key;
                    return (
                      <button key={key} className="btn btn-sm"
                        onClick={() => { setConnection(key); if (key !== 'answered') setResults(new Set()); setJustSaved(false); }}
                        style={{ borderColor: sel ? 'var(--gold)' : 'var(--border)', borderWidth: sel ? 1.5 : 1, color: sel ? 'var(--gold-dark)' : 'var(--text)', background: sel ? 'color-mix(in srgb, var(--gold) 14%, transparent)' : 'var(--surface)', fontWeight: sel ? 600 : 500 }}>
                        {label}
                      </button>
                    );
                  })}
                </div>

                {/* Section 2 — result of the conversation (answered only; multi-select). */}
                {answered && (
                  <div style={{ marginTop: 12, borderTop: '1px solid var(--border-light)', paddingTop: 12 }}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginBottom: 5 }}>What was the outcome? (pick one or more)</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {RESULT_OPTIONS.map(r => {
                        const c = outcomeColor(r.outcome); const sel = results.has(r.key);
                        return (
                          <button key={r.key} className="btn btn-sm"
                            onClick={() => { setResults(prev => { const n = new Set(prev); if (n.has(r.key)) n.delete(r.key); else n.add(r.key); return n; }); setJustSaved(false); }}
                            style={{ borderColor: sel ? c : 'var(--border)', borderWidth: sel ? 1.5 : 1, color: sel ? c : 'var(--text)', background: sel ? `color-mix(in srgb, ${c} 16%, transparent)` : 'var(--surface)', fontWeight: sel ? 600 : 500 }}>
                            {r.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {primaryIsCallback && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Call back on</span>
                    <input className="input" type="date" value={followUpAt} onChange={e => setFollowUpAt(e.target.value)} style={{ width: 170 }} />
                  </div>
                )}

                <textarea className="input" value={feedback} rows={3} style={{ resize: 'vertical', marginTop: 10 }}
                  placeholder={needFeedback ? 'Call feedback — what was said… (required)' : 'Call feedback — what was said…'}
                  onChange={e => { setFeedback(e.target.value); setJustSaved(false); }} />

                {connection != null && (
                  <button className="btn btn-primary" onClick={save} disabled={!canSave}
                    style={{ marginTop: 8, width: '100%', justifyContent: 'center', padding: '10px', background: 'var(--gold)', borderColor: 'var(--gold)', color: '#2A2013', opacity: canSave ? 1 : 0.5 }}>
                    <Icon name="check" size={16} /> {saving ? 'Saving…' : 'Save to record'}
                  </button>
                )}
                {justSaved && <div style={{ color: 'var(--success)', fontSize: '0.8rem', marginTop: 6, fontWeight: 600 }}>✓ Call logged to the record.</div>}
                {saveError && <ErrorBox>{saveError}</ErrorBox>}

                <div style={{ marginTop: 'auto', paddingTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <button className="btn" onClick={() => void tryClose()} disabled={locked} style={{ opacity: locked ? 0.5 : 1 }}>Close</button>
                  <div style={{ flex: 1 }} />
                  <button className="btn" onClick={() => void tryPrev()} disabled={locked || !hasPrev} style={{ opacity: (locked || !hasPrev) ? 0.5 : 1 }}>
                    <Icon name="chevronLeft" size={15} /> Previous
                  </button>
                  <button className="btn btn-primary" onClick={() => void tryNext()} disabled={locked || !hasNext} style={{ opacity: (locked || !hasNext) ? 0.5 : 1 }}>
                    Next property <Icon name="arrowRight" size={15} />
                  </button>
                </div>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', marginTop: 6 }}>Tip: use ← / → to flip between properties.</div>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={randomize} onChange={e => toggleRandomize(e.target.checked)} />
                  Randomise next property
                </label>
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

/** One number + label in the progress bar. */
function ProgressStat({ n, label, color, suffix }: { n: number; label: string; color?: string; suffix?: string }) {
  return (
    <div style={{ textAlign: 'center', minWidth: 44 }}>
      <div className="tabular-nums" style={{ fontSize: '1.05rem', fontWeight: 700, color: color ?? 'var(--text)', lineHeight: 1.1 }}>{n}{suffix ?? ''}</div>
      <div style={{ fontSize: '0.62rem', color: 'var(--text-secondary)' }}>{label}</div>
    </div>
  );
}

/** A pill next to the state chip: when this unit was last called, or "Never called". */
function LastCallPill({ at }: { at?: string }) {
  return (
    <span style={{
      fontSize: '0.72rem', padding: '3px 10px', borderRadius: 999, whiteSpace: 'nowrap',
      background: 'var(--surface-2)', border: '1px solid var(--border)',
      color: at ? 'var(--text-secondary)' : 'var(--text-tertiary)',
      display: 'inline-flex', alignItems: 'center', gap: 5,
    }}>
      <Icon name="phoneCall" size={11} /> {at ? `Last call ${timeAgo(at)}` : 'Never called'}
    </span>
  );
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
