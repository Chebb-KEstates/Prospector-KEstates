import { useState, useEffect } from 'react';

/**
 * A ticking clock for live countdowns: re-renders every `intervalMs` and
 * returns the current time in ms. One timer per component that needs it, but
 * cheap (a minute cadence by default) — enough for the assignment-timer badges
 * to stay honest without a per-second render storm.
 */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
