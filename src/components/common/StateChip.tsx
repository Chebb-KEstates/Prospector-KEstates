import React from 'react';
import { PropertyState, PropertyStateLabel, PropertyStage, PropertyStageLabel, CallOutcome, CallOutcomeLabel, CallOutcomeBuyerLabel } from '../../types/models';
import { OPEN_ACCESS } from '../../config';
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

/**
 * How a state reads on screen.
 *
 * Assigned model: portfolio is hidden as a user-facing concept for now — kept /
 * interested units read as "Assigned". The engine still uses the portfolio
 * state underneath, so this is purely a display fold and fully reversible.
 *
 * Open access: nobody holds a unit, so "In pool" and "Assigned" both read as
 * "Open", and an interested (portfolio) unit reads as "Interested". Display
 * only — the stored state is unchanged.
 */
export function stateDisplay(state: PropertyState): { label: string; color: string } {
  if (OPEN_ACCESS) {
    if (state === PropertyState.pool || state === PropertyState.assigned) {
      return { label: 'Open', color: stateColors[PropertyState.pool] };
    }
    if (state === PropertyState.portfolio) {
      return { label: 'Interested', color: stateColors[PropertyState.portfolio] };
    }
    return { label: PropertyStateLabel[state], color: stateColors[state] };
  }
  const shown = state === PropertyState.portfolio ? PropertyState.assigned : state;
  return { label: PropertyStateLabel[shown], color: stateColors[shown] };
}

/**
 * The State filter's options, in the words the chips use. Assigned model: the
 * facet states minus portfolio (folded into Assigned). Open access: "Open"
 * (value `pool` — the server widens it to pool + assigned), then the rest.
 */
export function stateFilterOptions(states: PropertyState[]): { value: PropertyState; label: string }[] {
  let shown: PropertyState[];
  if (OPEN_ACCESS) {
    const hasOpen = states.includes(PropertyState.pool) || states.includes(PropertyState.assigned);
    shown = [
      ...(hasOpen ? [PropertyState.pool] : []),
      ...states.filter(s => s !== PropertyState.pool && s !== PropertyState.assigned),
    ];
  } else {
    shown = states.filter(s => s !== PropertyState.portfolio);
  }
  return shown.map(s => ({ value: s, label: stateDisplay(s).label }));
}

/** Does a unit in `state` pass the State filter `filter`? (Open access: the
 *  "Open" option, value `pool`, also matches `assigned` — as on the server.) */
export function stateMatches(state: PropertyState, filter: PropertyState): boolean {
  if (OPEN_ACCESS && filter === PropertyState.pool) {
    return state === PropertyState.pool || state === PropertyState.assigned;
  }
  return state === filter;
}

export function StateChip({ state }: StateChipProps) {
  const { label, color } = stateDisplay(state);
  return (
    <span className="chip" style={{ background: `${color}20`, color }}>
      {label}
    </span>
  );
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

/**
 * The assignment-timer countdown shown beside the state chip for held units.
 * Renders nothing when there's no deadline (pool / cooling / dnc). Turns amber
 * inside the "expiring soon" window and red in the last two hours (or once
 * overdue and awaiting the sweep), so a broker sees at a glance what's slipping.
 */
export function CountdownBadge({ deadline, soonHours = 24 }: { deadline?: string; soonHours?: number }) {
  const now = useNow(60_000);
  const ms = remainingMs(deadline, now);
  // Open access: nobody holds a unit, so there is no countdown to show.
  if (OPEN_ACCESS || ms == null) return null;

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
