import React, { useState } from 'react';
import { CallStop } from '../../state/CallSessionContext';
import { CallOutcome, CallOutcomeLabel, CallOutcomeBuyerLabel } from '../../types/models';
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

/**
 * The rich, all-in-view call card (ported from call_flow.dart). Order:
 * small identity + flag → summarised record box → Call (reveals number) →
 * outcome grid that only SELECTS (never auto-advances) → follow-up when needed →
 * notes → gold "Save & next" (appears once an outcome is chosen) → full,
 * scrollable call-history timeline. Keyed by stop id in the parent, so switching
 * caller resets this card's state.
 */
export function CallCard({ stop, onComplete, onSkip, onReveal }: {
  stop: CallStop;
  onComplete: (outcome: CallOutcome) => void;
  onSkip: () => void;
  /** Fired after a successful reveal — callers use it to refresh a cap counter. */
  onReveal?: () => void;
}) {
  const hasPhone = !!stop.phoneMasked;
  // With no number on file there's nothing to reveal, so go straight to logging
  // (an unreachable owner still needs an outcome recorded).
  const [revealed, setRevealed] = useState(!hasPhone);
  const [phone, setPhone] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<CallOutcome | null>(null);
  const [note, setNote] = useState('');
  const [followUpAt, setFollowUpAt] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const label = (o: CallOutcome) => (stop.buyer ? CallOutcomeBuyerLabel[o] : CallOutcomeLabel[o]);
  const needsFollowUp = outcome === CallOutcome.callbackLater;
  const canSave = outcome != null && (!needsFollowUp || !!followUpAt) && !saving;

  /**
   * Pressing Call now fetches the number from the server — it is capped and
   * audited there. The card only reveals once that succeeds: showing the number
   * optimistically would mean showing one the audit trail never recorded.
   */
  const reveal = async () => {
    if (revealing) return;
    setRevealing(true);
    setRevealError(null);
    try {
      const real = await stop.reveal();
      setPhone(real);
      setRevealed(true);
      onReveal?.();
    } catch (err) {
      setRevealError(
        err instanceof ApiError ? err.message : 'Could not fetch the number. Try again.',
      );
    } finally {
      setRevealing(false);
    }
  };

  const pick = (o: CallOutcome) => {
    if (saving) return;
    setOutcome(o);
    if (o !== CallOutcome.callbackLater) setFollowUpAt('');
  };

  const saveNext = async () => {
    if (!canSave || !outcome) return;
    setSaving(true);
    setSaveError(null);
    const fu = followUpAt ? new Date(followUpAt).toISOString() : undefined;
    try {
      await stop.log(outcome, note.trim() || undefined, fu);
      onComplete(outcome);
    } catch (err) {
      // Never advance on a failed save — the outcome would be lost silently,
      // and the broker would have no idea the call wasn't recorded.
      setSaveError(
        err instanceof ApiError ? err.message : 'Could not save that. Try again.',
      );
      setSaving(false);
    }
  };

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14, maxHeight: '100%', overflow: 'auto' }}>
      {/* Identity */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
          background: 'var(--surface-2)', display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontSize: 18,
        }}>{stop.flag}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: '1.05rem', fontWeight: 600 }} className="truncate">{stop.name}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }} className="truncate">{stop.subtitle}</div>
        </div>
        <StateChip state={stop.state} />
      </div>

      {/* Summarised record box */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, background: 'var(--surface-2)' }}>
        <div style={{ fontSize: '0.6875rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: 6 }}>
          {stop.assetsTitle}
        </div>
        {stop.assets.slice(0, 6).map((a, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, justifyContent: 'space-between', padding: '3px 0', fontSize: '0.8125rem' }}>
            <span className="truncate" style={{ color: 'var(--text-secondary)' }}>{a.label}</span>
            <span className="truncate" style={{ textAlign: 'right', fontWeight: 500 }}>{a.value}</span>
          </div>
        ))}
        {stop.note && (
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border-light)', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            <b>Internal note:</b> {stop.note}
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
          {revealError && (
            <div style={{
              marginTop: 8, padding: '8px 12px', borderRadius: 8, fontSize: '0.8125rem',
              background: 'color-mix(in srgb, var(--error) 12%, transparent)',
              border: '1px solid color-mix(in srgb, var(--error) 45%, transparent)',
              color: 'var(--error)',
            }}>
              {revealError}
            </div>
          )}
        </div>
      ) : phone ? (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
          borderRadius: 10, background: 'color-mix(in srgb, var(--gold) 12%, transparent)',
          border: '1px solid color-mix(in srgb, var(--gold) 45%, transparent)',
        }}>
          <span className="tabular-nums" style={{ flex: 1, fontSize: '1.15rem', fontWeight: 700, letterSpacing: '1px', userSelect: 'all' }}>
            {phone}
          </span>
          <button className="btn btn-ghost btn-sm" onClick={() => navigator.clipboard?.writeText(phone)}>
            <Icon name="copy" size={15} /> Copy
          </button>
        </div>
      ) : (
        <div style={{
          padding: '8px 12px', borderRadius: 10, fontSize: '0.8125rem',
          color: 'var(--text-tertiary)', background: 'var(--surface-2)',
          border: '1px solid var(--border)',
        }}>
          No number on file — log an outcome below.
        </div>
      )}

      {/* Outcomes — select only, no auto-advance */}
      {revealed && (
        <div>
          <div style={{ fontSize: '0.6875rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: 6 }}>
            Log the outcome
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {(Object.values(CallOutcome) as CallOutcome[]).map(o => {
              const c = outcomeColor(o);
              const sel = outcome === o;
              return (
                <button key={o} onClick={() => pick(o)} className="btn btn-sm" style={{
                  borderColor: sel ? c : 'var(--border)',
                  borderWidth: sel ? 1.5 : 1,
                  color: sel ? c : 'var(--text)',
                  background: sel ? `color-mix(in srgb, ${c} 16%, transparent)` : 'var(--surface)',
                  fontWeight: sel ? 600 : 500,
                }}>{label(o)}</button>
              );
            })}
          </div>
        </div>
      )}

      {/* Follow-up date when calling back */}
      {revealed && needsFollowUp && (
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

      {/* Save & next — appears once an outcome is chosen */}
      {revealed && outcome != null && (
        <div>
          <button className="btn btn-primary" onClick={saveNext} disabled={!canSave} style={{
            justifyContent: 'center', padding: '11px', fontSize: '0.95rem', width: '100%',
            background: 'var(--gold)', borderColor: 'var(--gold)', color: '#2A2013',
            opacity: canSave ? 1 : 0.5,
          }}>
            <Icon name="check" size={18} /> {saving ? 'Saving…' : 'Save & next'}
          </button>
          {saveError && (
            <div style={{
              marginTop: 8, padding: '8px 12px', borderRadius: 8, fontSize: '0.8125rem',
              background: 'color-mix(in srgb, var(--error) 12%, transparent)',
              border: '1px solid color-mix(in srgb, var(--error) 45%, transparent)',
              color: 'var(--error)',
            }}>
              {saveError}
            </div>
          )}
        </div>
      )}

      {/* Full call history */}
      {stop.history.length > 0 && (
        <div>
          <div style={{ fontSize: '0.6875rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: 6 }}>
            Call history
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {stop.history.map((h, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, fontSize: '0.75rem' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', marginTop: 4, flexShrink: 0, background: outcomeColor(h.outcome) }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{label(h.outcome)}
                    <span style={{ fontWeight: 400, color: 'var(--text-secondary)' }}> · {fmtDate(h.at)} · {timeAgo(h.at)}</span>
                  </div>
                  {h.note && <div style={{ color: 'var(--text-secondary)' }}>{h.note}</div>}
                  {h.by && <div style={{ color: 'var(--text-tertiary)' }}>{h.by}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <button className="btn btn-ghost btn-sm" onClick={onSkip} style={{ alignSelf: 'flex-start' }}>Skip</button>
    </div>
  );
}
