import React, { useState } from 'react';
import { CallStop, CallUnit } from '../../state/CallSessionContext';
import { CallOutcome, CallOutcomeLabel, CallOutcomeBuyerLabel } from '../../types/models';
import type { PhoneEntry } from '../../types/models';
import { StateChip } from '../common/StateChip';
import { Icon } from '../common/Icon';
import { fmtDate, timeAgo } from '../../utils/format';
import { ApiError } from '../../data/apiClient';

function outcomeColor(o: CallOutcome): string {
  if (o === CallOutcome.interestedSell || o === CallOutcome.interestedRent) return 'var(--success)';
  if (o === CallOutcome.callbackLater) return 'var(--info)';
  if (o === CallOutcome.unreachable || o === CallOutcome.dnc) return 'var(--error)';
  if (o === CallOutcome.notInterested || o === CallOutcome.alreadyListed) return 'var(--warning)';
  return 'var(--text-secondary)';
}

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

type Tone = 'good' | 'warn' | 'info' | 'neutral';
function toneColor(t: Tone): string {
  if (t === 'good') return 'var(--success)';
  if (t === 'warn') return 'var(--warning)';
  if (t === 'info') return 'var(--info)';
  return 'var(--text-secondary)';
}

/** A soft tinted pill — the shared look for signal and rental chips. */
function ToneChip({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const c = toneColor(tone);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 9px',
      borderRadius: 999, fontSize: '0.72rem', fontWeight: 600, whiteSpace: 'nowrap',
      color: c, background: `color-mix(in srgb, ${c} 14%, transparent)`,
      border: `1px solid color-mix(in srgb, ${c} 32%, transparent)`,
    }}>{children}</span>
  );
}

const sectionLabel: React.CSSProperties = {
  fontSize: '0.6875rem', fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: 6,
};

/**
 * The rich, all-in-view call card. Order:
 *   identity + nationality → seller-signal chips → portfolio (each property with
 *   its own last sale + rental) → owner call history (always shown, so prior
 *   contact is read BEFORE dialling) → Call (reveals the number) → outcome:
 *   one result for a single property, or a per-property result for a multi-unit
 *   owner (so "interested" tags only the property it's about) → notes → gold
 *   "Save & next". Keyed by stop id in the parent, so switching caller resets it.
 */
export function CallCard({ stop, onComplete, onSkip, onReveal }: {
  stop: CallStop;
  onComplete: (outcome: CallOutcome) => void;
  onSkip: () => void;
  /** Fired after a successful reveal — callers use it to refresh a cap counter. */
  onReveal?: () => void;
}) {
  const hasPhone = !!stop.phoneMasked;
  const [revealed, setRevealed] = useState(!hasPhone);
  const [phones, setPhones] = useState<PhoneEntry[]>([]);
  const [phoneIdx, setPhoneIdx] = useState(0);
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);

  // A multi-property owner logs a result per property; everyone else logs one.
  const perProperty = !!(stop.units && stop.units.length > 1 && stop.logUnit);
  const [outcome, setOutcome] = useState<CallOutcome | null>(null);         // single-property / lead
  const [unitOutcomes, setUnitOutcomes] = useState<Record<string, CallOutcome | ''>>({}); // per property

  const [note, setNote] = useState('');
  const [followUpAt, setFollowUpAt] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const current = phones[phoneIdx];
  const nextNumber = () => setPhoneIdx(i => (i + 1) % phones.length);
  const label = (o: CallOutcome) => (stop.buyer ? CallOutcomeBuyerLabel[o] : CallOutcomeLabel[o]);
  const OUTCOMES = Object.values(CallOutcome) as CallOutcome[];

  // The results chosen so far, unified across the two modes.
  const chosen: [string, CallOutcome][] = perProperty
    ? (Object.entries(unitOutcomes).filter(([, o]) => o !== '') as [string, CallOutcome][])
    : (outcome ? [['self', outcome]] : []);
  const anyChosen = chosen.length > 0;
  const anyCallback = chosen.some(([, o]) => o === CallOutcome.callbackLater);
  const canSave = anyChosen && (!anyCallback || !!followUpAt) && !saving;

  const reveal = async () => {
    if (revealing) return;
    setRevealing(true);
    setRevealError(null);
    try {
      const real = await stop.reveal();
      setPhones(real);
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
    const trimmed = note.trim() || undefined;
    try {
      if (perProperty) {
        // One log per property, each with its own result — so the vault reflects
        // "Unit 13 interested, Unit 119 not" rather than tagging all the same.
        for (const [unitId, o] of chosen) {
          await stop.logUnit!(unitId, o, trimmed, o === CallOutcome.callbackLater ? fu : undefined);
        }
      } else {
        await stop.log(chosen[0][1], trimmed, fu);
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
            {[stop.nationality, stop.subtitle].filter(Boolean).join(' · ')}
          </div>
        </div>
        <StateChip state={stop.state} />
      </div>

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
              <div key={u.id} style={{ padding: '8px 0', borderTop: i > 0 ? '1px solid var(--border-light)' : undefined }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.8125rem' }} className="truncate">{u.label}</span>
                  {u.rental && <ToneChip tone={u.rental.tone}>{u.rental.label}</ToneChip>}
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
            {phones.length > 1 && (
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
          {phones.length > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
              <button className="btn btn-sm" onClick={nextNumber}
                style={{ borderColor: 'color-mix(in srgb, var(--gold) 45%, transparent)', color: 'var(--gold-dark)' }}>
                <Icon name="phone" size={14} /> Multiple numbers ({phones.length}) · show next
              </button>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>
                {phoneIdx + 1} of {phones.length} · {phones.map(p => p.label).join(' · ')}
              </span>
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
                outcomes={OUTCOMES} label={label} disabled={saving}
                onChange={o => setUnit(u.id, o)} />
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

      {/* Notes */}
      {revealed && (
        <textarea className="input" placeholder="Notes / what was said…" value={note}
          onChange={e => setNote(e.target.value)} rows={2} style={{ resize: 'vertical' }} />
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
          {saveError && <ErrorBox>{saveError}</ErrorBox>}
        </div>
      )}

      <button className="btn btn-ghost btn-sm" onClick={onSkip} style={{ alignSelf: 'flex-start' }}>Skip</button>
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

/** One property's outcome selector in the per-property logging view. */
function UnitOutcomeRow({ unit, value, outcomes, label, disabled, onChange }: {
  unit: CallUnit;
  value: CallOutcome | '';
  outcomes: CallOutcome[];
  label: (o: CallOutcome) => string;
  disabled: boolean;
  onChange: (o: CallOutcome | '') => void;
}) {
  const c = value ? outcomeColor(value) : 'var(--border)';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between',
      padding: '6px 8px', borderRadius: 8, background: 'var(--surface-2)',
      border: `1px solid ${value ? `color-mix(in srgb, ${c} 40%, transparent)` : 'var(--border-light)'}`,
    }}>
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
  );
}
