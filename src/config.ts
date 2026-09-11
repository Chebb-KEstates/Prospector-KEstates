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
