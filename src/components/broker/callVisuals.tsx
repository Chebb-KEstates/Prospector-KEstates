import React, { useState } from 'react';
import { CallUnit } from '../../state/CallSessionContext';
import { CallOutcome } from '../../types/models';
import { StateChip } from '../common/StateChip';
import { fmtDate, timeAgo } from '../../utils/format';
import { ApiError } from '../../data/apiClient';

/**
 * Shared visuals for the call card and the manager's property popup — one
 * language for outcome colours, tone chips, and the per-property detail dialog,
 * so the caller flow and the manager's read-only view look the same.
 */

export function outcomeColor(o: CallOutcome): string {
  if (o === CallOutcome.interestedSell || o === CallOutcome.interestedRent) return 'var(--success)';
  if (o === CallOutcome.callbackLater) return 'var(--info)';
  if (o === CallOutcome.unreachable || o === CallOutcome.dnc) return 'var(--error)';
  if (o === CallOutcome.notInterested || o === CallOutcome.alreadyListed) return 'var(--warning)';
  return 'var(--text-secondary)';
}

export type Tone = 'good' | 'warn' | 'info' | 'neutral';
export function toneColor(t: Tone): string {
  if (t === 'good') return 'var(--success)';
  if (t === 'warn') return 'var(--warning)';
  if (t === 'info') return 'var(--info)';
  return 'var(--text-secondary)';
}

/** A soft tinted pill — the shared look for signal and rental chips. */
export function ToneChip({ tone, children }: { tone: Tone; children: React.ReactNode }) {
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

export const sectionLabel: React.CSSProperties = {
  fontSize: '0.6875rem', fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: 6,
};

/**
 * The per-property popup: one unit's full detail, its own call feedback, and an
 * editable notes field saved to the record. Opened by clicking a property in a
 * portfolio (the call card, or the manager's property popup).
 */
export function UnitDetailDialog({ unit, ownerName, nationality, initialNotes, canEdit, label, onSave, onClose }: {
  unit: CallUnit;
  ownerName: string;
  nationality?: string;
  initialNotes: string;
  canEdit: boolean;
  label: (o: CallOutcome) => string;
  onSave: (notes: string) => Promise<void>;
  onClose: () => void;
}) {
  const [notes, setNotes] = useState(initialNotes);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = notes.trim() !== initialNotes.trim();

  const save = async () => {
    setSaving(true); setError(null);
    try {
      await onSave(notes.trim());
      setSaved(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save the notes. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 460, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ fontWeight: 600, fontSize: '1.05rem' }} className="truncate">{unit.label}</h3>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }} className="truncate">{unit.location}</div>
          </div>
          <StateChip state={unit.state} />
        </div>

        <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, background: 'var(--surface-2)', fontSize: '0.8125rem', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {unit.facts.length > 0 && <div style={{ color: 'var(--text-secondary)' }}>{unit.facts.join(' · ')}</div>}
          {unit.rental && <div><ToneChip tone={unit.rental.tone}>{unit.rental.label}</ToneChip></div>}
          {unit.lastSale && <div style={{ color: 'var(--text-secondary)' }}>Last sale: <b>{unit.lastSale}</b></div>}
          <div style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem', paddingTop: 4, borderTop: '1px solid var(--border-light)' }}>
            Owner: {ownerName}{nationality ? ` · ${nationality}` : ''}
          </div>
        </div>

        <div>
          <div style={sectionLabel}>Call feedback{unit.history.length > 0 ? ` (${unit.history.length})` : ''}</div>
          {unit.history.length === 0 ? (
            <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>No calls logged for this property yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 180, overflow: 'auto' }}>
              {unit.history.map((h, i) => (
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

        <div>
          <div style={sectionLabel}>Notes on this property</div>
          <textarea className="input" rows={4} style={{ resize: 'vertical', width: '100%' }}
            placeholder={canEdit ? 'Add notes saved to this record…' : 'No notes.'}
            value={notes} disabled={!canEdit || saving}
            onChange={e => { setNotes(e.target.value); setSaved(false); }} />
          {error && <div style={{ color: 'var(--error)', fontSize: '0.75rem', marginTop: 4 }}>{error}</div>}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn" onClick={onClose}>Close</button>
          {canEdit && (
            <button className="btn btn-primary" onClick={save} disabled={!dirty || saving}>
              {saving ? 'Saving…' : 'Save notes'}
            </button>
          )}
          {saved && !dirty && <span style={{ fontSize: '0.75rem', color: 'var(--success)' }}>Saved ✓</span>}
        </div>
      </div>
    </div>
  );
}
