import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useVault } from '../../state/VaultContext';
import { useAuth } from '../../state/AuthContext';
import { CallStop, CallUnit, CallHistoryEntry, OwnerNumbers } from '../../state/callTypes';
import { CallOutcome, PropertyState, Property } from '../../types/models';
import { AssignConflictDialog } from './AssignConflictDialog';
import type { PhoneEntry } from '../../types/models';
import { StateChip, CountdownBadge, OutcomeChip } from '../common/StateChip';
import { Icon } from '../common/Icon';
import { ApiError } from '../../data/apiClient';
import { sectionLabel, outcomeColor, splitFeedback, FeedbackChips } from '../broker/callVisuals';
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
  // "Agent" — the broker reached an agent, not the owner. A pure tag: it's written
  // into the feedback but keeps the unit in play (callback behaviour), no cooldown.
  { key: 'agent', label: 'Agent', outcome: CallOutcome.callbackLater },
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

/** The unit's most recent call (its current recorded status), or none. */
function latestEntry(u?: CallUnit): CallHistoryEntry | undefined {
  const h = u?.history;
  if (!h || h.length === 0) return undefined;
  return h.reduce((a, b) => (a.at >= b.at ? a : b));
}

/**
 * Which tabs represent a stored outcome — so reopening a record shows its
 * current status pre-selected (issue: "the outcome should still show when I come
 * back, even after reassignment"). A no-answer/unreachable is just the connection
 * step; the answered outcomes map to their canonical result chip.
 */
function presetForOutcome(o: CallOutcome): { connection: Connection; resultKey?: string } {
  switch (o) {
    case CallOutcome.noAnswer: return { connection: 'noAnswer' };
    case CallOutcome.unreachable: return { connection: 'unreachable' };
    case CallOutcome.interestedSell: return { connection: 'answered', resultKey: 'sell' };
    case CallOutcome.interestedRent: return { connection: 'answered', resultKey: 'rent' };
    case CallOutcome.callbackLater: return { connection: 'answered', resultKey: 'callback' };
    case CallOutcome.notInterested: return { connection: 'answered', resultKey: 'notInterested' };
    case CallOutcome.dnc: return { connection: 'answered', resultKey: 'dnc' };
    default: return { connection: 'answered' };
  }
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
  const { user } = useAuth();
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
  // The outcome tabs are pre-filled to the unit's current status when it opens,
  // so a reassigned agent still sees what it is. That preview must NOT arm the
  // Save button — only a deliberate change/confirm counts as a new call.
  const [outcomeTouched, setOutcomeTouched] = useState(false);
  // Manager handoff dialog for an "interested" call (choose broker / keep in pool).
  const [showHandoff, setShowHandoff] = useState(false);
  const [handoffBroker, setHandoffBroker] = useState('');

  // Persistent notes (per unit) — auto-saved on close / next / after a call log.
  const [notes, setNotes] = useState('');
  const [noteOverrides, setNoteOverrides] = useState<Record<string, string>>({});
  const [notesDirty, setNotesDirty] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);

  // Manager actions on the record (reclaim / reassign) — shown instead of the
  // dialer progress when a manager opens a record.
  const [mgrBroker, setMgrBroker] = useState('');
  const [mgrBusy, setMgrBusy] = useState(false);
  const [mgrMsg, setMgrMsg] = useState<string | null>(null);
  const [mgrConflict, setMgrConflict] = useState<{ conflictOwners: number; units: Property[] } | null>(null);

  // "Next property": next in the table order, or a random one when ticked.
  const [randomize, setRandomize] = useState(() => localStorage.getItem('prospector.popup.randomizeNext') === '1');

  // The actual path walked this session: `history` is the ordered breadcrumb,
  // `hpos` the position in it, so Previous retraces where you came from (even in
  // random mode) rather than jumping to the list-before unit. `visited` is every
  // distinct unit seen — it only grows, and drives the progress count.
  const [history, setHistory] = useState<string[]>([propertyId]);
  const [hpos, setHpos] = useState(0);
  const [visited, setVisited] = useState<Set<string>>(() => new Set([propertyId]));
  // Blocks a second navigation until the current one has loaded — so holding an
  // arrow key can't fire a storm of views on one unit (the old stale-closure bug).
  const navBusy = useRef(false);

  // A running tally of THIS popup session — like the dialer's progress bar.
  // Survives Next/Previous (the component isn't remounted on navigation).
  const [session, setSession] = useState({ made: 0, answered: 0, noAnswer: 0, interested: 0 });

  // History journal (for the focused unit)
  const [events, setEvents] = useState<PropertyEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsKey, setEventsKey] = useState(0);

  // "Add update" — a journal note without a call.
  const [addingUpdate, setAddingUpdate] = useState(false);
  const [updateText, setUpdateText] = useState('');
  const [updateSaving, setUpdateSaving] = useState(false);
  const [updateErr, setUpdateErr] = useState<string | null>(null);

  // The owner's other units (across areas / brokers / pool) — cross-area coordination.
  const [ownerUnits, setOwnerUnits] = useState<api.OwnerUnit[]>([]);
  const [requestingId, setRequestingId] = useState<string | null>(null);
  const [requestedIds, setRequestedIds] = useState<Set<string>>(new Set());
  const [requestErr, setRequestErr] = useState<string | null>(null);

  // Load the owner's card whenever the clicked unit changes (incl. "Next").
  useEffect(() => {
    let cancelled = false;
    navBusy.current = false; // this navigation has landed — allow the next one
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
    // Pre-fill the outcome tabs with the unit's current status so it's visible on
    // reopen (and for a new agent after reassignment). `outcomeTouched` stays
    // false so this preview can't be saved as a fresh call by accident.
    const last = latestEntry(focusedUnit);
    if (last) {
      const preset = presetForOutcome(last.outcome);
      setConnection(preset.connection);
      setResults(preset.resultKey ? new Set([preset.resultKey]) : new Set());
    } else {
      setConnection(null); setResults(new Set());
    }
    setOutcomeTouched(false);
    setFeedback(''); setFollowUpAt(''); setJustSaved(false);
    setAddingUpdate(false); setUpdateText(''); setUpdateErr(null);
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

  // The owner's full unit set (same for every unit of this owner) — for the
  // cross-area coordination list. Cheap; refetched when the focus changes.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const u = await api.properties.ownerHoldings(focusedId);
        if (!cancelled) setOwnerUnits(u);
      } catch {
        if (!cancelled) setOwnerUnits([]);
      }
    })();
    return () => { cancelled = true; };
  }, [focusedId, eventsKey]);

  const units = stop?.units ?? [];
  // Units of this owner NOT already in this popup — other areas, another broker,
  // or loose in the pool. These are what the coordination list surfaces.
  const stopUnitIds = new Set(units.map(u => u.id));
  const otherUnits = ownerUnits.filter(u => !stopUnitIds.has(u.id));

  // Ask the manager to assign a loose (pooled) unit of this owner to me too —
  // a hand-picked request through the normal approval loop.
  const requestUnit = async (u: api.OwnerUnit) => {
    setRequestErr(null); setRequestingId(u.id);
    try {
      await api.requests.submit({
        community: u.community,
        cluster: u.cluster || undefined,
        count: 1,
        unitIds: [u.id],
        note: 'Owner-linked — requested from the record popup',
      });
      setRequestedIds(s => new Set(s).add(u.id));
    } catch (e) {
      setRequestErr(e instanceof ApiError ? e.message : 'Could not send that request.');
    } finally {
      setRequestingId(null);
    }
  };
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
  // Only "Call back later" / "Possible future interest" schedule a follow-up date.
  // "Agent" also keeps the unit in play (callback disposition) but needs no
  // follow-up, so gate the date picker on the broker's intent, not the outcome.
  const wantsCallback = answered && selectedResults.some(r => r.key === 'callback' || r.key === 'future');
  const needFeedback = answered;                   // an answered call must be explained
  const canSave = primary != null
    && outcomeTouched                              // don't save the pre-filled status preview
    && (!answered || selectedResults.length > 0)   // answered ⇒ at least one result
    && (!needFeedback || feedback.trim().length > 0)
    && (!wantsCallback || !!followUpAt)
    && !saving;

  const locked = revealed && !savedSinceReveal;
  const total = ids.length;
  // The next unit going FORWARD: retrace the breadcrumb if we've stepped back,
  // else pick a fresh one (random prefers unseen so progress can reach 100%).
  const forwardTarget = (): string | undefined => {
    if (hpos < history.length - 1) return history[hpos + 1];
    if (randomize) {
      const unseen = ids.filter(id => !visited.has(id));
      const pool = unseen.length ? unseen : ids.filter(id => id !== propertyId);
      return pool.length ? pool[Math.floor(Math.random() * pool.length)] : undefined;
    }
    const i = ids.indexOf(propertyId);
    return i >= 0 ? ids[i + 1] : undefined;
  };
  const hasNext = !!forwardTarget();
  const hasPrev = hpos > 0;

  const curState = refresh[focusedId]?.state ?? focusedUnit?.state ?? PropertyState.pool;
  const curExpires = refresh[focusedId]?.expiresAt ?? focusedUnit?.expiresAt;
  // The unit's current recorded status — shown persistently so reopening the
  // record (even by a newly-assigned agent) makes its last outcome obvious.
  const lastStatus = latestEntry(focusedUnit);

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

  // Add a journal update without logging a call. Renews the hold server-side.
  const submitUpdate = async () => {
    const text = updateText.trim();
    if (!text || updateSaving) return;
    setUpdateSaving(true); setUpdateErr(null);
    try {
      await api.properties.addUpdate(focusedId, text);
      setUpdateText(''); setAddingUpdate(false);
      setEventsKey(k => k + 1); // refresh the journal
      try {
        const p2 = await api.properties.byId(focusedId);
        setRefresh(r => ({ ...r, [focusedId]: { state: p2.state, expiresAt: p2.assignmentExpiresAt } }));
      } catch { /* keep the old chip */ }
    } catch (e) {
      setUpdateErr(e instanceof ApiError ? e.message : 'Could not add that update.');
    } finally {
      setUpdateSaving(false);
    }
  };

  // Reflect a state change (reclaim / reassign) on the focused unit's chip + journal.
  const refreshFocused = async () => {
    try {
      const p2 = await api.properties.byId(focusedId);
      setRefresh(r => ({ ...r, [focusedId]: { state: p2.state, expiresAt: p2.assignmentExpiresAt } }));
    } catch { /* keep the old chip */ }
    setEventsKey(k => k + 1);
  };
  const reclaimNow = async () => {
    if (mgrBusy) return;
    setMgrBusy(true); setMgrMsg(null);
    try {
      const n = await vault.reclaim([focusedId]);
      await refreshFocused();
      setMgrMsg(`Reclaimed ${n} unit${n === 1 ? '' : 's'} to the pool.`);
    } catch (e) {
      setMgrMsg(e instanceof ApiError ? e.message : 'Could not reclaim that.');
    } finally { setMgrBusy(false); }
  };
  const assignNow = async (skip: boolean) => {
    setMgrBusy(true); setMgrMsg(null);
    try {
      const r = await vault.assign([focusedId], mgrBroker, undefined, skip);
      setMgrConflict(null);
      await refreshFocused();
      const bName = vault.userById(mgrBroker)?.name ?? 'broker';
      const parts = [`Reassigned to ${bName} (${r.assigned} unit${r.assigned === 1 ? '' : 's'})`];
      if (r.skippedUnits > 0) parts.push(`skipped ${r.skippedUnits} for ${r.skippedOwners} owner${r.skippedOwners === 1 ? '' : 's'} worked elsewhere`);
      setMgrMsg(parts.join(' — ') + '.');
      setMgrBroker('');
    } catch (e) {
      setMgrMsg(e instanceof ApiError ? e.message : 'Could not reassign that.');
    } finally { setMgrBusy(false); }
  };
  const startReassign = async () => {
    if (!mgrBroker || mgrBusy) return;
    setMgrBusy(true); setMgrMsg(null);
    try {
      const preview = await api.properties.assignPreview([focusedId], mgrBroker);
      if (preview.conflictOwners > 0) setMgrConflict(preview);
      else await assignNow(false);
    } catch (e) {
      setMgrMsg(e instanceof ApiError ? e.message : 'Could not check that reassignment.');
    } finally { setMgrBusy(false); }
  };

  const tryClose = async () => { if (locked) return; await flushNotes(); onClose(); };
  const tryNext = async () => {
    if (locked || navBusy.current || !onNavigate) return;
    const target = forwardTarget();
    if (!target) return;
    navBusy.current = true;
    await flushNotes();
    // Extend or retrace the breadcrumb, and remember we've seen this unit.
    if (hpos < history.length - 1 && history[hpos + 1] === target) setHpos(hpos + 1);
    else { setHistory(h => [...h.slice(0, hpos + 1), target]); setHpos(hpos + 1); }
    setVisited(v => (v.has(target) ? v : new Set(v).add(target)));
    onNavigate(target);
  };
  const tryPrev = async () => {
    if (locked || navBusy.current || hpos <= 0 || !onNavigate) return;
    const target = history[hpos - 1]; // the unit we actually came from
    navBusy.current = true;
    await flushNotes();
    setHpos(hpos - 1);
    onNavigate(target);
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

  /**
   * Toggle a call-outcome chip. Outcomes are multi-select, but "Interested"
   * (sell/rent) and "Not interested" (incl. "Living in property") are
   * contradictory — picking one clears the other, so a call can never be saved as
   * both interested and not interested.
   */
  const toggleResult = (opt: ResultOption) => {
    const isInterested = (o: CallOutcome) => o === CallOutcome.interestedSell || o === CallOutcome.interestedRent;
    const isNotInterested = (o: CallOutcome) => o === CallOutcome.notInterested;
    setResults(prev => {
      const n = new Set(prev);
      if (n.has(opt.key)) { n.delete(opt.key); return n; }
      if (isInterested(opt.outcome) || isNotInterested(opt.outcome)) {
        for (const o of RESULT_OPTIONS) {
          if (!n.has(o.key)) continue;
          const clash = isInterested(opt.outcome) ? isNotInterested(o.outcome) : isInterested(o.outcome);
          if (clash) n.delete(o.key);
        }
      }
      n.add(opt.key);
      return n;
    });
    setOutcomeTouched(true);
    setJustSaved(false);
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

  const primaryIsInterested = primary === CallOutcome.interestedSell || primary === CallOutcome.interestedRent;
  const isManager = !!user?.isManager;

  // A manager marking a unit "interested" would silently settle it into a
  // portfolio; instead prompt for who works it (defaulting to the current
  // holder) or to keep it in the pool. Brokers save straight through.
  const attemptSave = async () => {
    if (!canSave) return;
    if (isManager && primaryIsInterested) {
      let current = '';
      try { current = (await api.properties.byId(focusedId)).assignedTo ?? ''; } catch { /* default blank */ }
      setHandoffBroker(current);
      setShowHandoff(true);
      return;
    }
    await doSave();
  };

  const doSave = async (handoff?: { assignTo?: string; keepInPool?: boolean }) => {
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
      // Manager handoff: assign the owner's whole area group first (so the unit
      // and its siblings move to the chosen broker together), then log the call.
      if (handoff?.assignTo) await vault.assign([focusedId], handoff.assignTo);
      const keep = !!handoff?.keepInPool;
      if (stop.logUnit) await stop.logUnit(focusedId, primary!, note, wantsCallback ? fu : undefined, activeOwnerName, keep);
      else await stop.log(primary!, note, wantsCallback ? fu : undefined, activeOwnerName, keep);
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

  const answerRate = session.made > 0 ? Math.round((session.answered / session.made) * 100) : 0;

  return (
    <div className="modal-overlay" onClick={() => void tryClose()}
      style={total > 1 ? { flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', paddingTop: 12, gap: 12 } : undefined}>
      {/* Session progress — a rounded floating panel above the popup, matching the
          app's toolbar style. Stacked (not fixed) so it never overlaps the box.
          Brokers only: a manager gets record actions inside the box instead. */}
      {stop && total > 1 && !isManager && (
        <div onClick={e => e.stopPropagation()} style={{
          width: 'min(94vw, 1240px)', boxSizing: 'border-box', flexShrink: 0,
          display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap',
          padding: '10px 18px', background: 'var(--surface)',
          border: '1px solid var(--border)', borderRadius: 14,
          boxShadow: '0 12px 30px -12px rgba(0,0,0,0.30)',
        }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
              <b style={{ color: 'var(--text)', fontSize: '0.8rem' }}>Property {visited.size} of {total}</b>
              <span>{Math.max(0, total - visited.size)} to go</span>
            </div>
            <div style={{ marginTop: 6, height: 6, borderRadius: 999, background: 'var(--surface-2)', overflow: 'hidden' }}>
              <div style={{ width: `${Math.min(100, (visited.size / total) * 100)}%`, height: '100%', background: 'var(--gold)', transition: 'width .3s' }} />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <ProgressStat n={session.made} label="Made" />
            <ProgressStat n={session.answered} label="Answered" color="var(--info)" divider />
            <ProgressStat n={session.noAnswer} label="No answer" color="var(--warning)" divider />
            <ProgressStat n={answerRate} suffix="%" label="Answer rate" color="var(--gold-dark)" divider />
          </div>
        </div>
      )}
      <div className="modal-content" onClick={e => e.stopPropagation()}
        style={{ width: '94vw', maxWidth: 1240, ...(total > 1 ? { flex: 1, minHeight: 0 } : { height: '90vh' }), display: 'flex', flexDirection: 'column', gap: 14, padding: 20 }}>
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

            {/* Manager actions — reclaim / reassign this record's owner group. Shown
                in place of the dialer progress bar a broker would see. */}
            {isManager && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', flexShrink: 0,
                padding: '9px 12px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--border-light)',
              }}>
                <span style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-tertiary)', fontWeight: 600 }}>Manager actions</span>
                <button className="btn btn-sm" disabled={mgrBusy} onClick={() => void reclaimNow()}
                  title="Return this owner's units in this area to the pool">
                  <Icon name="refresh" size={13} /> Reclaim to pool
                </button>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <select className="input" value={mgrBroker} disabled={mgrBusy}
                    onChange={e => setMgrBroker(e.target.value)} style={{ width: 'auto', minWidth: 150, padding: '5px 8px' }}>
                    <option value="">Reassign to…</option>
                    {vault.brokers.filter(b => b.active).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                  <button className="btn btn-sm btn-primary" disabled={!mgrBroker || mgrBusy} onClick={() => void startReassign()}>
                    {mgrBusy ? 'Working…' : 'Reassign'}
                  </button>
                </div>
                {mgrMsg && <span style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>{mgrMsg}</span>}
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

                {/* This owner's OTHER units — other areas, another broker, or the
                    pool — so a broker sees the whole owner and can request a loose
                    one. Shown even for a single-unit stop. */}
                {otherUnits.length > 0 && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={sectionLabel}>This owner’s other properties ({otherUnits.length})</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginBottom: 6 }}>
                      Same owner, not assigned to you.
                    </div>
                    <div style={{ maxHeight: 160, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, paddingRight: 4 }}>
                      {otherUnits.map(u => {
                        const area = [u.community, u.cluster].filter(Boolean).join(' · ');
                        const holder = u.assigneeId
                          ? (user && u.assigneeId === user.id ? 'you' : (vault.userById(u.assigneeId)?.name ?? 'another broker'))
                          : null;
                        const requested = requestedIds.has(u.id);
                        return (
                          <div key={u.id} style={{
                            display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between',
                            border: '1px solid var(--border)', borderRadius: 10, padding: '8px 10px', background: 'var(--surface-2)',
                          }}>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 600, fontSize: '0.82rem', whiteSpace: 'normal', wordBreak: 'break-word' }}>{u.label}</div>
                              {area && <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>{area}</div>}
                            </div>
                            <div style={{ flexShrink: 0, textAlign: 'right' }}>
                              {holder ? (
                                <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>With {holder}</span>
                              ) : requested ? (
                                <span style={{ fontSize: '0.72rem', color: 'var(--success)', fontWeight: 600, whiteSpace: 'nowrap' }}>Requested ✓</span>
                              ) : !user?.isManager ? (
                                <button className="btn btn-sm" disabled={requestingId === u.id}
                                  onClick={() => void requestUnit(u)} style={{ whiteSpace: 'nowrap' }}>
                                  {requestingId === u.id ? 'Sending…' : 'Request'}
                                </button>
                              ) : (
                                <span style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>Not assigned</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {requestErr && <div style={{ color: 'var(--error)', fontSize: '0.72rem', marginTop: 4 }}>{requestErr}</div>}
                  </div>
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

                {/* Current status — the last recorded outcome, persistent across
                    reopen and reassignment. The tabs below start on this status. */}
                {lastStatus && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                    marginBottom: 10, padding: '7px 11px', borderRadius: 10,
                    background: 'var(--surface-2)', border: '1px solid var(--border-light)',
                  }}>
                    <span style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-tertiary)', fontWeight: 600 }}>Current status</span>
                    <OutcomeChip outcome={lastStatus.outcome} />
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>
                      {[vault.userById(lastStatus.by ?? '')?.name, timeAgo(lastStatus.at)].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                )}

                {/* Section 1 — did the call connect? */}
                <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginBottom: 5 }}>Did the call connect?</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {([['answered', 'Answered'], ['noAnswer', 'No answer'], ['unreachable', 'Call didn’t connect']] as [Connection, string][]).map(([key, label]) => {
                    const sel = connection === key;
                    return (
                      <button key={key} className="btn btn-sm"
                        onClick={() => { setConnection(key); if (key !== 'answered') setResults(new Set()); setOutcomeTouched(true); setJustSaved(false); }}
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
                            onClick={() => toggleResult(r)}
                            style={{ borderColor: sel ? c : 'var(--border)', borderWidth: sel ? 1.5 : 1, color: sel ? c : 'var(--text)', background: sel ? `color-mix(in srgb, ${c} 16%, transparent)` : 'var(--surface)', fontWeight: sel ? 600 : 500 }}>
                            {r.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {wantsCallback && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Call back on</span>
                    <input className="input" type="date" value={followUpAt} onChange={e => setFollowUpAt(e.target.value)} style={{ width: 170 }} />
                  </div>
                )}

                <textarea className="input" value={feedback} rows={3} style={{ resize: 'vertical', marginTop: 10 }}
                  placeholder={needFeedback ? 'Call feedback — what was said… (required)' : 'Call feedback — what was said…'}
                  onChange={e => { setFeedback(e.target.value); setJustSaved(false); }} />

                {lastStatus && !outcomeTouched && (
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginTop: 8 }}>
                    Showing the last recorded outcome. Pick an outcome to log a <b>new</b> call, or use <b>Add update</b> to note progress without a call.
                  </div>
                )}
                {connection != null && (
                  <button className="btn btn-primary" onClick={() => void attemptSave()} disabled={!canSave}
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                  <div style={{ ...sectionLabel, marginBottom: 0, flex: 1 }}>History journal{multiUnit ? ` — ${focusedUnit?.label ?? ''}` : ''}</div>
                  {!addingUpdate && (
                    <button className="btn btn-sm" onClick={() => { setAddingUpdate(true); setUpdateErr(null); }}
                      style={{
                        flexShrink: 0, fontWeight: 600, borderColor: 'var(--gold)', borderWidth: 1.5,
                        color: 'var(--gold-dark)', background: 'color-mix(in srgb, var(--gold) 14%, transparent)',
                      }}
                      title="Add a note to the journal without logging a call">
                      <Icon name="plus" size={14} /> Add update
                    </button>
                  )}
                </div>

                {/* Compose a journal update — no call logged. */}
                {addingUpdate && (
                  <div style={{ marginBottom: 10, padding: 10, borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--border-light)' }}>
                    <textarea className="input" value={updateText} rows={3} autoFocus
                      style={{ resize: 'vertical', width: '100%' }}
                      placeholder="Add an update — progress, an email sent, a viewing booked… (no call logged)"
                      onChange={e => { setUpdateText(e.target.value); setUpdateErr(null); }} />
                    {updateErr && <ErrorBox>{updateErr}</ErrorBox>}
                    <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
                      <button className="btn btn-sm btn-ghost" disabled={updateSaving}
                        onClick={() => { setAddingUpdate(false); setUpdateText(''); setUpdateErr(null); }}>Cancel</button>
                      <button className="btn btn-sm btn-primary" disabled={updateSaving || !updateText.trim()} onClick={() => void submitUpdate()}>
                        {updateSaving ? 'Adding…' : 'Add to journal'}
                      </button>
                    </div>
                  </div>
                )}
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

      {showHandoff && (
        <div className="modal-overlay" style={{ zIndex: 1100 }} onClick={e => { e.stopPropagation(); setShowHandoff(false); }}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <h3 style={{ fontWeight: 600, marginBottom: 8 }}>Interested owner — who works it?</h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: 14, lineHeight: 1.5 }}>
              You marked this owner interested. Assign the owner's units <b>in this area</b> to a broker — they move
              together as one group — or keep it in the pool for now.
            </p>
            <select className="input" value={handoffBroker} onChange={e => setHandoffBroker(e.target.value)} style={{ width: '100%', marginBottom: 16 }}>
              <option value="">— Select broker —</option>
              {vault.brokers.filter(b => b.active).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button className="btn btn-sm btn-ghost" onClick={() => setShowHandoff(false)}>Cancel</button>
              <button className="btn btn-sm" disabled={saving} onClick={() => { setShowHandoff(false); void doSave({ keepInPool: true }); }}>Keep in pool</button>
              <button className="btn btn-sm btn-primary" disabled={!handoffBroker || saving} onClick={() => { setShowHandoff(false); void doSave({ assignTo: handoffBroker }); }}>
                Assign &amp; save
              </button>
            </div>
          </div>
        </div>
      )}

      {mgrConflict && (
        <AssignConflictDialog
          brokerName={vault.userById(mgrBroker)?.name ?? 'this broker'}
          conflictOwners={mgrConflict.conflictOwners}
          conflictUnits={mgrConflict.units}
          busy={mgrBusy}
          onProceedAll={() => void assignNow(false)}
          onSkip={() => void assignNow(true)}
          onCancel={() => setMgrConflict(null)} />
      )}
    </div>
  );
}

function Column({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflowY: 'auto', paddingRight: 4 }}>{children}</div>;
}

/** One number + micro-label in the session progress panel, with an optional divider. */
function ProgressStat({ n, label, color, suffix, divider }: {
  n: number; label: string; color?: string; suffix?: string; divider?: boolean;
}) {
  return (
    <div style={{ textAlign: 'center', minWidth: 50, padding: '0 12px', borderLeft: divider ? '1px solid var(--border-light)' : undefined }}>
      <div className="tabular-nums" style={{ fontSize: '1.15rem', fontWeight: 800, color: color ?? 'var(--text)', lineHeight: 1 }}>{n}{suffix ?? ''}</div>
      <div style={{ fontSize: '0.58rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-tertiary)', marginTop: 3 }}>{label}</div>
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
  const isNote = e.kind === 'audit' && e.action === 'note';
  const icon = e.kind === 'call' ? 'phoneCall'
    : e.kind === 'import' ? 'upload'
      : e.action === 'note' ? 'plus'
        : e.action === 'view' ? 'eye'
          : e.action === 'assign' ? 'assign'
            : e.action === 'reclaim' ? 'refresh'
              : e.action === 'update' ? 'refresh'
                : 'clock';
  const who = e.kind === 'import' ? undefined : actorName(e.actorId ?? '') ?? undefined;
  // A call's ticked results are kept in the note as "[Label · Label] free text";
  // show every ticked label as a chip, not just the single strongest outcome.
  const fb = e.kind === 'call' ? splitFeedback(e.note) : { tags: [] as string[], text: '' };
  return (
    <div style={{ display: 'flex', gap: 10, paddingBottom: 10, borderBottom: '1px solid var(--border-light)' }}>
      <div style={{ width: 26, height: 26, borderRadius: '50%', flexShrink: 0, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)' }}>
        <Icon name={icon as any} size={14} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {e.kind === 'call' && (fb.tags.length
            ? <FeedbackChips tags={fb.tags} color={outcomeColor(e.outcome)} />
            : <OutcomeChip outcome={e.outcome} />)}
          <span style={{ fontWeight: 600, fontSize: '0.82rem' }}>
            {e.kind === 'call' ? (e.ownerName ? `Call · ${e.ownerName}` : 'Call') : isNote ? 'Update' : e.detail}
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
        {e.kind === 'call' && fb.text && <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: 2 }}>“{fb.text}”</div>}
        {e.kind === 'audit' && e.action === 'note' && <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: 2, whiteSpace: 'pre-wrap' }}>{e.detail}</div>}
        <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginTop: 2 }}>
          {[who, fmtDateTime(e.at), timeAgo(e.at)].filter(Boolean).join(' · ')}
        </div>
      </div>
    </div>
  );
}
