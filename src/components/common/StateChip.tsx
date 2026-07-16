import React from 'react';
import { PropertyState, PropertyStateLabel, CallOutcome, CallOutcomeLabel, CallOutcomeBuyerLabel } from '../../types/models';

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
