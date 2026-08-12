import { CallOutcome, PropertyState } from '../types/models';
import type { PhoneEntry } from '../types/models';

/**
 * Shared call-related types — the shape of a "call stop" (one owner or lead with
 * everything the call card / record popup renders) and the structured detail
 * behind a unit's boxes. These are pure types, used by the record popup and the
 * single-record call dialog. (The old flipping calling-session lived here too and
 * was removed — brokers now work units straight from the database table + popup.)
 */

/** One entry in a caller's call-history timeline. */
export interface CallHistoryEntry {
  at: string;
  outcome: CallOutcome;
  note?: string;
  by?: string;
  /** Which co-owner this call was about, when the unit has several. */
  ownerName?: string;
}

export interface AssetRow { label: string; value: string; }

/** How a chip reads at a glance: an opportunity, a warning, info, or plain. */
export type ChipTone = 'good' | 'warn' | 'info' | 'neutral';

/** A computed "why this owner is worth calling" chip (portfolio, tenure, vacancy…). */
export interface CallSignal { label: string; tone: ChipTone; }

/** One property in the owner's portfolio, richly described for the caller. */
export interface CallUnit {
  id: string;                                 // property id — so an outcome can be logged for THIS unit
  label: string;                              // "Unit 13"
  location: string;                           // "Dubai Hills Estate · Maple 1"
  facts: string[];                            // ["5 bed", "Townhouse", "2,734 sqft", "Type 2E", "Floor G+1"]
  rental?: { label: string; tone: ChipTone }; // "Vacant" / "Rented · ends 12 Sep 2026"
  lastSale?: string;                          // this property's own last transaction — "AED 3,550,000 · 28 Jun 2022"
  state: PropertyState;                       // current state, shown in the per-unit popup
  history: CallHistoryEntry[];                // this unit's own call history
  notes?: string;                             // free-text notes saved on the record
  expiresAt?: string;                         // assignment deadline — drives the countdown badge
  detail?: UnitDetail;                        // structured breakdown for the property-view popup
}

/**
 * The structured breakdown behind a unit's card — drives the property-view
 * popup's separate "property facts / last sale / rental" boxes. `facts` are
 * labelled pairs; `sale` is null when there's no transaction on record; the
 * rental carries `endsInDays` so the popup can flag a lease running out.
 */
export interface UnitDetail {
  facts: { label: string; value: string }[];
  sale: { value?: string; date?: string; type?: string } | null;
  rental: { status: string; tone: ChipTone; amount?: string; start?: string; end?: string; endsInDays?: number | null };
  lastCalledAt?: string;
}

/** One co-owner shown before reveal — name + their own masked number(s). */
export interface OwnerContact {
  name: string;
  nationality?: string;
  phoneMasked?: string;
  phonesMasked?: PhoneEntry[];
}
/** One co-owner's real number(s), after reveal. */
export interface OwnerNumbers { name: string; phones: PhoneEntry[]; }
/** What `reveal()` returns: the flat list (primary), plus per-owner groups. */
export interface RevealedNumbers { phones: PhoneEntry[]; owners: OwnerNumbers[]; }

/**
 * A single call stop — one owner (with all their units) or one buyer lead.
 * Carries everything the rich card renders, plus two closures that reach the
 * server: `reveal` and `log`. Built by ownerCallStops / leadCallStops (callable-only).
 */
export interface CallStop {
  id: string;
  name: string;
  flag: string;
  buyer: boolean;
  /** The MASKED number ("••••••1234"), or undefined when there is none. Display only. */
  phoneMasked?: string;
  /** Every number the primary owner has (Mobile 1 / 2 / …), MASKED — display only. */
  phonesMasked?: PhoneEntry[];
  /**
   * Fetch the real numbers — the audited, single-record reveal. Resolves to every
   * number on record, labelled and grouped, as ONE reveal (owner's whole card).
   */
  reveal: () => Promise<RevealedNumbers>;
  /** Co-owners of the unit (masked), for the owner switcher. */
  owners?: OwnerContact[];
  subtitle: string;
  assetsTitle: string;
  assets: AssetRow[];
  nationality?: string;
  signals?: CallSignal[];
  units?: CallUnit[];
  state: PropertyState;
  note?: string;
  history: CallHistoryEntry[];
  /** Log one outcome for the whole stop (single-unit owner, or a buyer lead). */
  log: (outcome: CallOutcome, note: string | undefined, followUpAt: string | undefined, ownerName?: string) => Promise<void>;
  /** Log an outcome for ONE of the owner's properties (multi-unit owner stops). */
  logUnit?: (unitId: string, outcome: CallOutcome, note: string | undefined, followUpAt: string | undefined, ownerName?: string) => Promise<void>;
  /** Save the free-text notes on one property (owner stops only). */
  saveNote?: (unitId: string, notes: string) => Promise<void>;
}
