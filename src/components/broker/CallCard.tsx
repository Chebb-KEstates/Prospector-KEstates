import React, { useState, useEffect } from 'react';
import { CallStop, CallUnit, OwnerNumbers } from '../../state/CallSessionContext';
import { CallOutcome, CallOutcomeLabel, CallOutcomeBuyerLabel } from '../../types/models';
import type { PhoneEntry } from '../../types/models';
import { StateChip } from '../common/StateChip';
import { Icon } from '../common/Icon';
import { fmtDate, timeAgo, splitOwnerNames } from '../../utils/format';
import { ApiError } from '../../data/apiClient';
import { outcomeColor, ToneChip, sectionLabel, UnitDetailDialog } from './callVisuals';

/** How positive an outcome is — used to pick one representative result for a
 *  multi-property call so the session's reached/interested stats stay right. */
function rank(o: CallOutcome): number {
  switch (o) {
    case CallOutcome.interestedSell:
    case CallOutcome.interestedRent: return 6;
    case CallOutcome.callbackLater: return 5;
    case CallOutcome.alreadyListed: return 4;
    case CallOutcome.notInterested:
    case CallOutcome.dnc: return 3;
    case CallOutcome.unreachable: return 2;
    default: return 1; // noAnswer
  }
}
function representative(outcomes: CallOutcome[]): CallOutcome {
  return outcomes.reduce((best, o) => (rank(o) > rank(best) ? o : best), outcomes[0]);
}

/**
 * The rich, all-in-view call card. Order:
 *   identity + nationality → seller-signal chips → portfolio (each property with
 *   its own last sale + rental) → owner call history (always shown, so prior
 *   contact is read BEFORE dialling) → Call (reveals the number) → outcome:
 *   one result for a single property, or a per-property result for a multi-unit
 *   owner (so "interested" tags only the property it's about) → notes → gold
 *   "Save & next". Keyed by stop id in the parent, so switching caller resets it.
 */
export function CallCard({ stop, onComplete, onSkip, onReveal, onLockChange }: {
  stop: CallStop;
  onComplete: (outcome: CallOutcome) => void;
  onSkip: () => void;
  /** Fired after a successful reveal — callers use it to refresh a cap counter. */
  onReveal?: () => void;
  /**
   * True once the number is revealed and no result has been saved yet. The
   * dialer uses this to lock navigation, so a broker can't reveal a number and
   * move on without logging — the reveal is only worthwhile if it's recorded.
   */
  onLockChange?: (locked: boolean) => void;
}) {
  const hasPhone = !!stop.phoneMasked;
  const [revealed, setRevealed] = useState(!hasPhone);
  const [phones, setPhones] = useState<PhoneEntry[]>([]);
  const [revealedOwners, setRevealedOwners] = useState<OwnerNumbers[]>([]);
  const [phoneIdx, setPhoneIdx] = useState(0);
  // Which co-owner the broker is looking at / speaking to (the switcher).
  const [activeOwner, setActiveOwner] = useState(0);
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);

  // A multi-property owner logs a result per property; everyone else logs one.
  const perProperty = !!(stop.units && stop.units.length > 1 && stop.logUnit);
  const [outcome, setOutcome] = useState<CallOutcome | null>(null);         // single-property / lead
  const [unitOutcomes, setUnitOutcomes] = useState<Record<string, CallOutcome | ''>>({}); // per property
  const [unitNotes, setUnitNotes] = useState<Record<string, string>>({});   // feedback per property

  const [note, setNote] = useState('');
  const [followUpAt, setFollowUpAt] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // The per-unit detail popup + a local map of notes saved this session, so
  // reopening a unit shows the just-saved text.
  const [openUnit, setOpenUnit] = useState<CallUnit | null>(null);
  const [noteOverrides, setNoteOverrides] = useState<Record<string, string>>({});

  // A co-owned unit lists each owner with their OWN number — the switcher picks
  // which owner is in view. Single-owner units use the flat `phones`.
  const multiOwner = !!(stop.owners && stop.owners.length > 1);
  const activePhones = multiOwner ? (revealedOwners[activeOwner]?.phones ?? []) : phones;
  const activeOwnerName = multiOwner ? stop.owners![activeOwner]?.name : undefined;
  const current = activePhones[phoneIdx];
  const ownerNames = multiOwner ? stop.owners!.map(o => o.name) : splitOwnerNames(stop.name);
  const nextNumber = () => setPhoneIdx(i => (i + 1) % Math.max(1, activePhones.length));
  const label = (o: CallOutcome) => (stop.buyer ? CallOutcomeBuyerLabel[o] : CallOutcomeLabel[o]);
  const OUTCOMES = Object.values(CallOutcome) as CallOutcome[];

  // The results chosen so far, unified across the two modes.
  const chosen: [string, CallOutcome][] = perProperty
    ? (Object.entries(unitOutcomes).filter(([, o]) => o !== '') as [string, CallOutcome][])
    : (outcome ? [['self', outcome]] : []);
  const anyChosen = chosen.length > 0;
  const anyCallback = chosen.some(([, o]) => o === CallOutcome.callbackLater);
  const isReached = (o: CallOutcome) => o !== CallOutcome.noAnswer && o !== CallOutcome.unreachable;
  // Feedback text for a given result — per-property in the multi-unit view, or
  // the single shared note otherwise.
  const noteFor = (id: string) => (perProperty ? (unitNotes[id] ?? '') : note).trim();
  // Someone was actually reached → feedback is required (avoids a bare "log &
  // move on"). In the multi-unit view the note is required PER reached property,
  // so "interested on Unit 13" carries its own words instead of being copied
  // onto every other unit. No-answer / unreachable need no note.
  const feedbackOk = chosen.every(([id, o]) => !isReached(o) || noteFor(id).length > 0);
  // Single-property placeholder still keys off "was anyone reached".
  const singleNeedFeedback = !perProperty && chosen.some(([, o]) => isReached(o));
  const canSave = anyChosen && (!anyCallback || !!followUpAt) && feedbackOk && !saving;

  // The card is "locked" once a number is revealed: the broker must log a
  // result before the dialer will let them move to the next caller.
  useEffect(() => { onLockChange?.(revealed); }, [revealed, onLockChange]);

  const reveal = async () => {
    if (revealing) return;
    setRevealing(true);
    setRevealError(null);
    try {
      const real = await stop.reveal();
      setPhones(real.phones);
      setRevealedOwners(real.owners);
      setPhoneIdx(0);
      setRevealed(true);
      onReveal?.();
    } catch (err) {
      setRevealError(err instanceof ApiError ? err.message : 'Could not fetch the number. Try again.');
    } finally {
      setRevealing(false);
    }
  };

  const setUnit = (id: string, o: CallOutcome | '') =>
    setUnitOutcomes(prev => ({ ...prev, [id]: o }));
  const setAllUnits = (o: CallOutcome | '') => {
    const next: Record<string, CallOutcome | ''> = {};
    for (const u of stop.units ?? []) next[u.id] = o;
    setUnitOutcomes(next);
  };

  const saveNext = async () => {
    if (!canSave) return;
    setSaving(true);
    setSaveError(null);
    const fu = followUpAt ? new Date(followUpAt).toISOString() : undefined;
    try {
      if (perProperty) {
        // One log per property, each with its OWN result AND its own feedback —
        // so "Unit 13 interested, said X" is saved only on Unit 13, never copied
        // onto the owner's other units.
        for (const [unitId, o] of chosen) {
          const n = (unitNotes[unitId] ?? '').trim() || undefined;
          await stop.logUnit!(unitId, o, n, o === CallOutcome.callbackLater ? fu : undefined, activeOwnerName);
        }
      } else {
        await stop.log(chosen[0][1], note.trim() || undefined, fu, activeOwnerName);
      }
      onComplete(representative(chosen.map(([, o]) => o)));
    } catch (err) {
      // Never advance on a failed save — the result would be lost silently.
      setSaveError(err instanceof ApiError ? err.message : 'Could not save that. Try again.');
      setSaving(false);
    }
  };

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14, maxHeight: '100%', overflow: 'auto' }}>
      {openUnit && (
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

      {/* Identity */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
          background: 'var(--surface-2)', display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontSize: 20,
        }}>{stop.flag}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: '1.05rem', fontWeight: 600, lineHeight: 1.2 }} className="truncate">{stop.name}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }} className="truncate">
            {[ownerNames.length > 1 ? `${ownerNames.length} owners` : null, stop.nationality, stop.subtitle].filter(Boolean).join(' · ')}
          </div>
        </div>
        <StateChip state={stop.state} />
      </div>

      {/* Co-owner switcher — each owner has their OWN number; pick who you're
          calling. The choice drives the number shown below and tags the
          feedback to that owner. */}
      {multiOwner && stop.owners && (
        <div style={{ padding: '8px 12px', borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--border-light)' }}>
          <div style={sectionLabel}>Owners ({stop.owners.length}) — who are you calling?</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {stop.owners.map((o, i) => {
              const sel = i === activeOwner;
              return (
                <button key={i} className="btn btn-sm" onClick={() => { setActiveOwner(i); setPhoneIdx(0); }}
                  style={{
                    borderColor: sel ? 'var(--gold)' : 'var(--border)', borderWidth: sel ? 1.5 : 1,
                    background: sel ? 'color-mix(in srgb, var(--gold) 14%, transparent)' : 'var(--surface)',
                    color: sel ? 'var(--gold-dark)' : 'var(--text)', fontWeight: sel ? 600 : 500,
                  }}>
                  <Icon name="user" size={12} /> {o.name || `Owner ${i + 1}`}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Seller signals — the "why call now" at a glance */}
      {stop.signals && stop.signals.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {stop.signals.map((s, i) => <ToneChip key={i} tone={s.tone}>{s.label}</ToneChip>)}
        </div>
      )}

      {/* Portfolio — each property with its OWN last sale + rental read */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, background: 'var(--surface-2)' }}>
        <div style={sectionLabel}>{stop.assetsTitle}</div>

        {stop.units && stop.units.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {stop.units.slice(0, 8).map((u, i) => (
              <div key={u.id} onClick={() => setOpenUnit(u)} title="View details, call feedback & notes"
                style={{ padding: '8px 6px', margin: '0 -6px', borderRadius: 8, cursor: 'pointer', borderTop: i > 0 ? '1px solid var(--border-light)' : undefined }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.8125rem', display: 'inline-flex', alignItems: 'center', gap: 5 }} className="truncate">
                    {u.label}
                    {(noteOverrides[u.id] ?? u.notes) && <span title="Has notes" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--gold)' }} />}
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    {u.rental && <ToneChip tone={u.rental.tone}>{u.rental.label}</ToneChip>}
                    <Icon name="chevronRight" size={14} style={{ color: 'var(--text-tertiary)' }} />
                  </span>
                </div>
                {u.location && <div className="truncate" style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>{u.location}</div>}
                {u.facts.length > 0 && <div className="truncate" style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{u.facts.join(' · ')}</div>}
                {u.lastSale && (
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginTop: 1 }}>
                    Last sale: <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{u.lastSale}</span>
                  </div>
                )}
              </div>
            ))}
            {stop.units.length > 8 && (
              <div style={{ paddingTop: 6, fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>+{stop.units.length - 8} more</div>
            )}
          </div>
        ) : (
          stop.assets.slice(0, 6).map((a, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, justifyContent: 'space-between', padding: '3px 0', fontSize: '0.8125rem' }}>
              <span className="truncate" style={{ color: 'var(--text-secondary)' }}>{a.label}</span>
              <span className="truncate" style={{ textAlign: 'right', fontWeight: 500 }}>{a.value}</span>
            </div>
          ))
        )}

        {stop.note && (
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border-light)', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            <b>Internal note:</b> {stop.note}
          </div>
        )}
      </div>

      {/* Owner call history — always shown so prior contact is read before dialling */}
      <div>
        <div style={sectionLabel}>
          Call history{stop.history.length > 0 ? ` (${stop.history.length})` : ''}
        </div>
        {stop.history.length === 0 ? (
          <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', padding: '6px 10px', borderRadius: 8, background: 'var(--surface-2)', border: '1px solid var(--border-light)' }}>
            No previous calls — this is first contact.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {stop.history.map((h, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, fontSize: '0.75rem' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', marginTop: 4, flexShrink: 0, background: outcomeColor(h.outcome) }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{label(h.outcome)}
                    {h.ownerName && <span style={{ fontWeight: 500, color: 'var(--gold-dark)' }}> · {h.ownerName}</span>}
                    <span style={{ fontWeight: 400, color: 'var(--text-secondary)' }}> · {fmtDate(h.at)} · {timeAgo(h.at)}</span>
                  </div>
                  {h.note && <div style={{ color: 'var(--text-secondary)' }}>“{h.note}”</div>}
                  {h.by && <div style={{ color: 'var(--text-tertiary)' }}>{h.by}</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Call / number reveal */}
      {!revealed ? (
        <div>
          <button className="btn btn-primary" onClick={reveal} disabled={revealing}
            style={{ justifyContent: 'center', padding: '12px', fontSize: '0.95rem', width: '100%' }}>
            <Icon name="phoneCall" size={18} /> {revealing ? 'Fetching number…' : 'Call'}
          </button>
          {revealError && <ErrorBox>{revealError}</ErrorBox>}
        </div>
      ) : current ? (
        <div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
            borderRadius: 10, background: 'color-mix(in srgb, var(--gold) 12%, transparent)',
            border: '1px solid color-mix(in srgb, var(--gold) 45%, transparent)',
          }}>
            {multiOwner && (
              <span className="chip" style={{ background: 'var(--surface)', color: 'var(--gold-dark)', fontWeight: 700, flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                <Icon name="user" size={11} /> {activeOwnerName}
              </span>
            )}
            {activePhones.length > 1 && (
              <span className="chip" style={{ background: 'var(--surface)', color: 'var(--gold-dark)', fontWeight: 700, flexShrink: 0 }}>
                {current?.label}
              </span>
            )}
            <span className="tabular-nums" style={{ flex: 1, fontSize: '1.15rem', fontWeight: 700, letterSpacing: '1px', userSelect: 'all' }}>
              {current?.number}
            </span>
            <button className="btn btn-ghost btn-sm" onClick={() => current && navigator.clipboard?.writeText(current.number)}>
              <Icon name="copy" size={15} /> Copy
            </button>
          </div>
          {activePhones.length > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
              <button className="btn btn-sm" onClick={nextNumber}
                style={{ borderColor: 'color-mix(in srgb, var(--gold) 45%, transparent)', color: 'var(--gold-dark)' }}>
                <Icon name="phone" size={14} /> Multiple numbers ({activePhones.length}) · show next
              </button>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>
                {phoneIdx + 1} of {activePhones.length} · {activePhones.map(p => p.label).join(' · ')}
              </span>
            </div>
          )}
          {multiOwner && (
            <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', marginTop: 6 }}>
              {activeOwnerName}’s number — use the owner buttons above to switch.
            </div>
          )}
        </div>
      ) : (
        <div style={{
          padding: '8px 12px', borderRadius: 10, fontSize: '0.8125rem',
          color: 'var(--text-tertiary)', background: 'var(--surface-2)', border: '1px solid var(--border)',
        }}>
          No number on file — log an outcome below.
        </div>
      )}

      {/* Outcome — one result, or one per property for a multi-unit owner */}
      {revealed && !perProperty && (
        <div>
          <div style={sectionLabel}>Log the outcome</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {OUTCOMES.map(o => {
              const c = outcomeColor(o);
              const sel = outcome === o;
              return (
                <button key={o} onClick={() => !saving && setOutcome(o)} className="btn btn-sm" style={{
                  borderColor: sel ? c : 'var(--border)', borderWidth: sel ? 1.5 : 1,
                  color: sel ? c : 'var(--text)',
                  background: sel ? `color-mix(in srgb, ${c} 16%, transparent)` : 'var(--surface)',
                  fontWeight: sel ? 600 : 500,
                }}>{label(o)}</button>
              );
            })}
          </div>
        </div>
      )}

      {revealed && perProperty && stop.units && (
        <div>
          <div style={sectionLabel}>Result per property</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginBottom: 8 }}>
            Record what was said for each — leave “Not discussed” if it didn't come up.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {stop.units.map(u => (
              <UnitOutcomeRow key={u.id} unit={u} value={unitOutcomes[u.id] ?? ''}
                note={unitNotes[u.id] ?? ''} outcomes={OUTCOMES} label={label} disabled={saving}
                onChange={o => setUnit(u.id, o)}
                onNote={n => setUnitNotes(prev => ({ ...prev, [u.id]: n }))} />
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>Set all to</span>
            <select className="input" style={{ width: 'auto', minWidth: 150, padding: '5px 8px' }} value=""
              disabled={saving} onChange={e => e.target.value && setAllUnits(e.target.value as CallOutcome)}>
              <option value="">Choose…</option>
              {OUTCOMES.map(o => <option key={o} value={o}>{label(o)}</option>)}
            </select>
          </div>
        </div>
      )}

      {/* Follow-up date when any result is "call back later" */}
      {revealed && anyCallback && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>Call back on</span>
          <input className="input" type="date" value={followUpAt} onChange={e => setFollowUpAt(e.target.value)} style={{ width: 180 }} />
        </div>
      )}

      {/* Notes — one shared box for a single property / lead. In the multi-unit
          view each property gets its OWN feedback field (inside its row above),
          so a note is never copied across the owner's other units. */}
      {revealed && !perProperty && (
        <textarea className="input" value={note} rows={2} style={{ resize: 'vertical' }}
          placeholder={singleNeedFeedback ? 'Feedback / what was said… (required)' : 'Notes / what was said…'}
          onChange={e => setNote(e.target.value)} />
      )}

      {/* Save & next — appears once a result is chosen */}
      {revealed && anyChosen && (
        <div>
          <button className="btn btn-primary" onClick={saveNext} disabled={!canSave} style={{
            justifyContent: 'center', padding: '11px', fontSize: '0.95rem', width: '100%',
            background: 'var(--gold)', borderColor: 'var(--gold)', color: '#2A2013',
            opacity: canSave ? 1 : 0.5,
          }}>
            <Icon name="check" size={18} /> {saving ? 'Saving…' : 'Save & next'}
          </button>
          {!canSave && !saving && (
            <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginTop: 6, textAlign: 'center' }}>
              {anyCallback && !followUpAt ? 'Pick a call-back date to save.'
                : !feedbackOk ? (perProperty ? 'Add feedback for each property you spoke to.' : 'Add feedback to save this call.')
                : ''}
            </div>
          )}
          {saveError && <ErrorBox>{saveError}</ErrorBox>}
        </div>
      )}

      {/* Skip only before the number is revealed. Once revealed, the broker must
          log a result — no slipping past a number they've already spent a view on. */}
      {!revealed ? (
        <button className="btn btn-ghost btn-sm" onClick={onSkip} style={{ alignSelf: 'flex-start' }}>Skip this owner</button>
      ) : !anyChosen && (
        <div style={{ fontSize: '0.72rem', color: 'var(--gold-dark)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Icon name="alert" size={13} /> Log a result to finish — the call is counted once you save.
        </div>
      )}
    </div>
  );
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      marginTop: 8, padding: '8px 12px', borderRadius: 8, fontSize: '0.8125rem',
      background: 'color-mix(in srgb, var(--error) 12%, transparent)',
      border: '1px solid color-mix(in srgb, var(--error) 45%, transparent)',
      color: 'var(--error)',
    }}>{children}</div>
  );
}

/** One property's outcome + its own feedback, in the per-property logging view. */
function UnitOutcomeRow({ unit, value, note, outcomes, label, disabled, onChange, onNote }: {
  unit: CallUnit;
  value: CallOutcome | '';
  note: string;
  outcomes: CallOutcome[];
  label: (o: CallOutcome) => string;
  disabled: boolean;
  onChange: (o: CallOutcome | '') => void;
  onNote: (note: string) => void;
}) {
  const c = value ? outcomeColor(value) : 'var(--border)';
  // Feedback is asked for (and required) once this property's owner was reached.
  const reached = !!value && value !== CallOutcome.noAnswer && value !== CallOutcome.unreachable;
  return (
    <div style={{
      padding: '6px 8px', borderRadius: 8, background: 'var(--surface-2)',
      border: `1px solid ${value ? `color-mix(in srgb, ${c} 40%, transparent)` : 'var(--border-light)'}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: '0.8125rem' }} className="truncate">{unit.label}</div>
          <div className="truncate" style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>{unit.location}</div>
        </div>
        <select className="input" style={{ width: 'auto', minWidth: 150, padding: '5px 8px', color: value ? c : undefined }}
          value={value} disabled={disabled} onChange={e => onChange(e.target.value as CallOutcome | '')}>
          <option value="">Not discussed</option>
          {outcomes.map(o => <option key={o} value={o}>{label(o)}</option>)}
        </select>
      </div>
      {reached && (
        <textarea className="input" value={note} rows={2} disabled={disabled}
          style={{ resize: 'vertical', marginTop: 8, fontSize: '0.8125rem' }}
          placeholder={`Feedback for ${unit.label}… (required)`}
          onChange={e => onNote(e.target.value)} />
      )}
    </div>
  );
}
