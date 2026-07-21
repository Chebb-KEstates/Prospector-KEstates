import React from 'react';
import { PropertyState, PropertyStateLabel, CallOutcome, CallOutcomeLabel, CallOutcomeBuyerLabel } from '../../types/models';
import { useNow } from '../../utils/useNow';
import { remainingMs, formatRemaining, fmtDateTime } from '../../utils/format';
import { Icon } from './Icon';

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
  [CallOutcome.interestedSell]: '#2E7D32',
  [CallOutcome.interestedRent]: '#66BB6A',
  [CallOutcome.notInterested]: '#C62828',
  [CallOutcome.alreadyListed]: '#C62828',
  [CallOutcome.dnc]: '#1A1A1A',
};

interface StateChipProps {
  state: PropertyState;
}

export function StateChip({ state }: StateChipProps) {
  return (
    <span className="chip" style={{
      background: `${stateColors[state]}20`,
      color: stateColors[state],
    }}>
      {PropertyStateLabel[state]}
    </span>
  );
}

/**
 * The assignment-timer countdown shown beside the state chip for held units.
 * Renders nothing when there's no deadline (pool / cooling / dnc). Turns amber
 * inside the "expiring soon" window and red in the last two hours (or once
 * overdue and awaiting the sweep), so a broker sees at a glance what's slipping.
 */
export function CountdownBadge({ deadline, soonHours = 24 }: { deadline?: string; soonHours?: number }) {
  const now = useNow(60_000);
  const ms = remainingMs(deadline, now);
  if (ms == null) return null;

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
