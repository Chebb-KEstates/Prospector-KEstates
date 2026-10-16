import React from 'react';
import { PropertyState, PropertyStateLabel, PropertyStage, PropertyStageLabel, CallOutcome, CallOutcomeLabel, CallOutcomeBuyerLabel } from '../../types/models';
import { useNow } from '../../utils/useNow';
import { remainingMs, formatRemaining, fmtDateTime } from '../../utils/format';
import { Icon } from './Icon';
import { useVault } from '../../state/VaultContext';
import { holdTimerOn } from '../../logic/dispositions';

const stateColors: Record<PropertyState, string> = {
  [PropertyState.pool]: '#6B6560',
  [PropertyState.assigned]: '#1565C0',
  [PropertyState.portfolio]: '#2E7D32',
  [PropertyState.cooling]: '#E65100',
  [PropertyState.dnc]: '#C62828',
};

const outcomeColors: Record<CallOutcome, string> = {
  [CallOutcome.noAnswer]: '#9C9690',
  [CallOutcome.unreachable]: '#9C9690',
  [CallOutcome.callbackLater]: '#E65100',
  [CallOutcome.textRequested]: '#00838F',
  [CallOutcome.interestedSell]: '#2E7D32',
  [CallOutcome.interestedRent]: '#66BB6A',
  [CallOutcome.notInterested]: '#C62828',
  [CallOutcome.alreadyListed]: '#C62828',
  [CallOutcome.dnc]: '#1A1A1A',
};

interface StateChipProps {
  state: PropertyState;
}

export const stageColors: Record<PropertyStage, string> = {
  [PropertyStage.none]: '#9C9690',
  [PropertyStage.prospecting]: '#1565C0',
  [PropertyStage.marketAppraisal]: '#B26A00',
  [PropertyStage.listedOffline]: '#6A1B9A',
  [PropertyStage.listedOnline]: '#2E7D32',
};

/** The listing-journey stage as a chip. "None" reads quietly, as a dash. */
export function StageChip({ stage }: { stage: PropertyStage }) {
  if (stage === PropertyStage.none) return <span style={{ color: 'var(--text-tertiary)' }}>—</span>;
  const color = stageColors[stage];
  return (
    <span className="chip" style={{ background: `${color}1c`, color, whiteSpace: 'nowrap' }}>
      {PropertyStageLabel[stage]}
    </span>
  );
}

export function StateChip({ state }: StateChipProps) {
  // Portfolio is hidden as a user-facing concept for now — kept/interested units
  // read as "Assigned". The engine still uses the portfolio state underneath, so
  // this is purely a display fold and fully reversible.
  const shown = state === PropertyState.portfolio ? PropertyState.assigned : state;
  return (
    <span className="chip" style={{
      background: `${stateColors[shown]}20`,
      color: stateColors[shown],
    }}>
      {PropertyStateLabel[shown]}
    </span>
  );
}

/**
 * The assignment-timer countdown shown beside the state chip for held units.
 * Renders nothing when there's no deadline (pool / cooling / dnc). Turns amber
 * inside the "expiring soon" window and red in the last two hours (or once
 * overdue and awaiting the sweep), so a broker sees at a glance what's slipping.
 */
export function CountdownBadge({ deadline, soonHours = 24, state }: { deadline?: string; soonHours?: number; state?: PropertyState }) {
  const now = useNow(60_000);
  const { settings } = useVault();
  const ms = remainingMs(deadline, now);
  // A switched-off timer (setting 0) shows no countdown, even if the unit still
  // carries a deadline from before it was switched off — nothing will act on it.
  if (ms == null || (state != null && !holdTimerOn(state, settings))) return null;

  const hoursLeft = ms / 3_600_000;
  const color = ms <= 0 || hoursLeft <= 2 ? '#C62828'
    : hoursLeft <= soonHours ? '#B26A00'
    : '#6B6560';

  return (
    <span className="chip tabular-nums" title={`Auto-returns to the pool · ${fmtDateTime(deadline)}`}
      style={{
        background: `${color}18`, color, whiteSpace: 'nowrap',
        display: 'inline-flex', alignItems: 'center', gap: 3,
      }}>
      <Icon name="clock" size={11} /> {formatRemaining(ms)}
    </span>
  );
}

interface OutcomeChipProps {
  outcome: CallOutcome;
  buyer?: boolean;
}

export function OutcomeChip({ outcome, buyer }: OutcomeChipProps) {
  const label = buyer ? CallOutcomeBuyerLabel[outcome] : CallOutcomeLabel[outcome];
  return (
    <span className="chip" style={{
      background: `${outcomeColors[outcome]}20`,
      color: outcomeColors[outcome],
    }}>
      {label}
    </span>
  );
}
