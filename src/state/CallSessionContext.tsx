import React, { createContext, useContext, useState, useCallback } from 'react';
import { CallOutcome, PropertyState, isInterested } from '../types/models';
import type { PhoneEntry } from '../types/models';

/** One entry in a caller's call-history timeline. */
export interface CallHistoryEntry {
  at: string;
  outcome: CallOutcome;
  note?: string;
  by?: string;
}

export interface AssetRow { label: string; value: string; }

/** How a chip reads at a glance: an opportunity, a warning, info, or plain. */
export type ChipTone = 'good' | 'warn' | 'info' | 'neutral';

/** A computed "why this owner is worth calling" chip (portfolio, tenure, vacancy…). */
export interface CallSignal { label: string; tone: ChipTone; }

/** One property in the owner's portfolio, richly described for the caller. */
export interface CallUnit {
  label: string;                              // "Unit 13"
  location: string;                           // "Dubai Hills Estate · Maple 1"
  facts: string[];                            // ["5 bed", "Townhouse", "2,734 sqft", "Type 2E", "Floor G+1"]
  rental?: { label: string; tone: ChipTone }; // "Vacant" / "Rented · ends 12 Sep 2026"
}

/**
 * A single stop in a calling session — one owner (with all their units) or one
 * buyer lead. Carries everything the rich card renders, plus two closures that
 * reach the server: `reveal` and `log`. Built by ownerCallStops / leadCallStops
 * (callable-only).
 */
export interface CallStop {
  id: string;
  name: string;
  flag: string;
  buyer: boolean;
  /**
   * The MASKED number ("••••••1234"), or undefined when there is none.
   *
   * Display only — never a real number. It exists so the card can tell
   * "callable" from "no number on file" without asking the server. Pressing
   * Call goes through `reveal()`.
   */
  phoneMasked?: string;
  /**
   * Fetch the real numbers. Resolves to EVERY number on record, labelled
   * (Mobile 1 / Mobile 2 / …) and grouped for display ("+971 50 123 4567");
   * rejects with an ApiError if the caller has spent their daily cap.
   * Always at least one entry.
   *
   * This is a server round trip on purpose: it's the audited, capped,
   * single-record reveal, and it is the only way a real number reaches this
   * browser. Revealing an owner returns their whole contact card as ONE reveal,
   * so a broker isn't charged three of their daily cap for one person.
   */
  reveal: () => Promise<PhoneEntry[]>;
  subtitle: string;
  assetsTitle: string;
  assets: AssetRow[];
  /**
   * Richer, owner-only fields the card prefers when present. Buyer-lead stops
   * leave them undefined, and the card falls back to `assets`.
   */
  nationality?: string;
  signals?: CallSignal[];
  units?: CallUnit[];
  lastSale?: string;
  state: PropertyState;
  note?: string;
  history: CallHistoryEntry[];
  log: (outcome: CallOutcome, note: string | undefined, followUpAt: string | undefined) => Promise<void>;
}

export interface CallSessionState {
  title: string;
  stops: CallStop[];
  index: number;
  minimized: boolean;
  worked: number;
  reached: number;
  interested: number;
}

interface CallSessionValue {
  session: CallSessionState | null;
  start: (stops: CallStop[], title: string) => void;
  setIndex: (i: number) => void;
  next: () => void;
  prev: () => void;
  logged: (outcome: CallOutcome) => void;
  minimize: () => void;
  resume: () => void;
  end: () => void;
}

const Ctx = createContext<CallSessionValue | null>(null);

function connected(o: CallOutcome) {
  return o !== CallOutcome.noAnswer && o !== CallOutcome.unreachable;
}

export function CallSessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<CallSessionState | null>(null);

  const start = useCallback((stops: CallStop[], title: string) => {
    if (stops.length === 0) return;
    setSession({ title, stops, index: 0, minimized: false, worked: 0, reached: 0, interested: 0 });
  }, []);

  const setIndex = useCallback((i: number) => {
    setSession(s => (s ? { ...s, index: Math.max(0, Math.min(s.stops.length - 1, i)) } : s));
  }, []);

  const next = useCallback(() => setSession(s => (s ? { ...s, index: Math.min(s.stops.length - 1, s.index + 1) } : s)), []);
  const prev = useCallback(() => setSession(s => (s ? { ...s, index: Math.max(0, s.index - 1) } : s)), []);

  const logged = useCallback((outcome: CallOutcome) => {
    setSession(s => {
      if (!s) return s;
      const worked = s.worked + 1;
      const reached = s.reached + (connected(outcome) ? 1 : 0);
      const interested = s.interested + (isInterested(outcome) ? 1 : 0);
      const index = Math.min(s.stops.length - 1, s.index + 1);
      return { ...s, worked, reached, interested, index };
    });
  }, []);

  const minimize = useCallback(() => setSession(s => (s ? { ...s, minimized: true } : s)), []);
  const resume = useCallback(() => setSession(s => (s ? { ...s, minimized: false } : s)), []);
  const end = useCallback(() => setSession(null), []);

  return (
    <Ctx.Provider value={{ session, start, setIndex, next, prev, logged, minimize, resume, end }}>
      {children}
    </Ctx.Provider>
  );
}

export function useCallSession(): CallSessionValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useCallSession must be used within CallSessionProvider');
  return ctx;
}
