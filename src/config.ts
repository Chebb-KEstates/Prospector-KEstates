/**
 * App-level feature flags.
 *
 * `LEADS_ENABLED` hides the Buyer Leads section everywhere in the UI — the
 * Database "Buyer leads" tab, the broker's Owners/Buyer-leads switch, the import
 * wizard's Leads module, and the home "buyer leads" tile. Prospector is a
 * property-owner calling tool for now; buyer leads are future work. The leads
 * code and any imported lead data are untouched — flip this to `true` to bring
 * the section back with no other change.
 */
export const LEADS_ENABLED = false;

/**
 * `OPEN_VIEW` — everyone can SEE every unit; only its owner can WORK it.
 *
 * ON (true):
 *  - Every user can open any unit and see its owner details, including the
 *    full number. There is no "Reveal" step, so there is no reveal-lock.
 *  - Working a unit (logging a call, notes, updates, listing info, stage) still
 *    belongs to the broker it is assigned to, or a manager. Anyone else sees it
 *    read-only, with "This unit belongs to X" and a "Take over ownership" button
 *    (or "Request this unit" for a pooled unit). Either one sends a request the
 *    manager approves or denies; approving a take-over moves the unit (with that
 *    owner's other units in the same area) to the requester.
 *  - A broker's history journal shows only real work. Stage changes, record
 *    opens and number reveals are for managers' eyes only (enforced by the API).
 *  - Assignments, requests, the Pool and the assignment timers work as before.
 *
 * OFF (false) restores masked numbers and assigned-only visibility, with no data
 * migration. The server compiles this same file (see server/tsconfig.json), so
 * the client and the API always agree on the mode.
 */
export const OPEN_VIEW = true;
