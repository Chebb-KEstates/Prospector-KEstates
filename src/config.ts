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
 * `OPEN_ACCESS` — every unit is open to everyone, with no assignments.
 *
 * ON (true):
 *  - Every user (broker or manager) sees, opens and works every unit. Nobody is
 *    assigned anything and nobody requests access: the Pool tab, the Requests
 *    tab, Assign / Reclaim / Reassign and the assignment timers are all hidden,
 *    and the server refuses the assignment/request endpoints.
 *  - Owner numbers are sent and shown in full. The "Reveal number" step is gone
 *    (opening a record is still written to the audit trail).
 *  - The expiry sweep no longer returns held units to the pool. A unit that was
 *    marked "not interested" / "already listed" still comes back after its cooldown.
 *
 * OFF (false) restores the assigned, masked, request-driven model as it was.
 *
 * This is a CODE switch only. No database column was dropped or rewritten:
 * `assigned_to`, the timers, `requests` and `request_units` stay exactly as they
 * were, so flipping this back needs no data migration. One thing to know before
 * flipping it back: units still held from before carry their old timers, so the
 * first sweep afterwards returns any long-expired ones to the pool.
 *
 * The server compiles this same file (see server/tsconfig.json), so the client
 * and the API can never disagree about which mode they are in.
 */
export const OPEN_ACCESS = true;
