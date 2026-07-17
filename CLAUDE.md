# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Read `README.md` first — it carries the product framing and the **data-protection rules**, which are
requirements, not style preferences. `PORT-PROGRESS.md` records what was built and why.

## Commands

```bash
npm install
npm start                      # dev server → http://localhost:3000
npm run build                  # production build → build/
npm test                       # Jest via react-scripts (watch mode)

CI=true npx react-scripts test --watchAll=false                              # full suite once (38 tests)
CI=true npx react-scripts test --watchAll=false src/logic/dispositions.test.ts   # one file
CI=true npx react-scripts test --watchAll=false -t "masks"                   # one test by name
npx tsc --noEmit               # typecheck (no package.json script for this)
```

There is no lint script — ESLint runs inside `react-scripts` during `start`/`build` via the
`eslintConfig` block in `package.json`. Do not `eject`.

## Architecture

### The repository seam is the whole point

`data/vaultRepository.ts` defines the `VaultRepository` interface and one `LocalVaultRepository`
(IndexedDB via `data/vaultDb.ts`) behind it. Everything above it — contexts, screens — talks only to
that interface. Swapping this single module for a hosted backend is the stated go-live path, so
**keep new persistence behind the interface** rather than reaching into `vaultDb` from a component.

`VaultContext` loads one `VaultSnapshot` (all datasets/properties/leads/calls/requests/settings/
audit/users) into memory and serves every derived query from it. There is no pagination or lazy
loading at the data layer; tables paginate in the UI.

### Mutate-in-place + `copyState` — the pattern you must follow

The domain models are classes, and `VaultContext` mutates instances directly, then forces a re-render
with `setSnap(prev => copyState({ ...prev }))`. This is deliberate and load-bearing: `copyState`
shallow-copies the arrays so React sees a new snapshot even though the objects inside are the same
identities. See `assign`, `reclaim`, `logCall` in `state/VaultContext.tsx`.

Consequence: **a mutation without its `copyState` call renders nothing**, and memoizing on object
identity will not see updates. Follow the existing shape — mutate, `await vaultRepo.save*`, `copyState`,
`_audit` — rather than introducing immutable updates in one place only.

### `Property` and `Lead` are two shapes over one lifecycle

Both implement `ProspectFields` (`types/models.ts`), which is why `logic/dispositions.ts`
(`applyOutcome`, `sweepCooldowns`, `isPortfolioStale`) is generic over `ProspectFields` and drives
owners and buyer leads alike. `PropertyState` (pool → assigned → portfolio / cooling / dnc) is the
lead state enum too, despite the name. Anything added to the lifecycle belongs in `dispositions.ts`
so both modules inherit it; `VaultContext` deliberately mirrors each operation into a `*Leads` twin.

`applyOutcome` is where the business rules live — cooldown windows, the auto-return to pool after
`maxNoAnswerAttempts`, DNC. It reads `VaultSettings`, so never hardcode a threshold.

### Identity and dedupe keys

- `Property.unitKey` — built by `ImportPipeline.unitKeyFor`, `u|community|cluster|building|unit` or
  `p|community|plot`. This is the dedupe key across imports: re-importing a unit **updates** the
  existing record rather than inserting. `norm()` lowercases and strips leading zeros from short
  numerics, so `Unit 007` and `unit 7` collide on purpose.
- `Lead.leadKey` — phone, else email, else name.
- `ownerKeyOf` (`logic/ownerGrouping.ts`) — phone, else name. **`assign()` silently expands a batch to
  every pool unit sharing owner+community.** One owner is never split across brokers; the audit line
  says "incl. N owner-linked". Expect assigning 1 unit to assign 4.

### Import is a dry-run pipeline

`ImportWizard`/`LeadImportWizard` → `logic/importPipeline.ts` `dryRun()` → returns `DryRunResult`
(new vs updated vs invalid vs in-file dupes) → the user confirms → `commitImport`.

Two dataset shapes, auto-detected by `detectType`: a `register` (one row per unit) and DLD
`transactions` (many rows per unit, collapsed by picking the latest buyer row as the current owner).

`autoMapHeader` is **order-dependent** — `buildingno` (a vendor row-id, ignored) must be tested before
`building`. A test exists for exactly this because the plain `Building` header regressed once. Add a
test alongside any new mapping rule.

Unmapped columns that still have a real header survive into `Property.extra` / `Lead.extra` and render
as dynamic columns. Uploads stay flexible — don't "clean up" `extra`.

### Phone masking is a two-function contract

`maskedPhone` (lists, always) vs `prettyPhone` (the sanctioned single-record reveal). A reveal goes
through `VaultContext.recordView`, which enforces the per-user daily cap (`viewCapOverride ??
settings.dailyViewCap`, managers exempt) and writes an audit entry — a blocked reveal is audited as
`cap-block`. `AssignmentsScreen` once hand-rolled a table and leaked unmasked phones; the fix was to
route it through the shared table. **New surfaces reuse `PropertyTable`/`LeadTable`, not a fresh
`<table>`.**

### One table language

`components/common/tableLayout.tsx` (`useTableLayout` + `ColumnsDialog`) is the single implementation
of column visibility/order/density, persisted per screen under `prospector.table.<key>.v2` in
localStorage. `PropertyTable` and `LeadTable` both build on it. Extend it rather than forking it.

### Contexts and cross-tab sync

`App.tsx` nests `ThemeProvider → AuthProvider → VaultProvider → Watermark + routes`; `ProtectedRoute`
sends managers to `/manager` and brokers to `/broker`. `CallSessionContext` keeps the dialer alive
across navigation (minimize/resume).

Writes bump a revision key through `data/tabSync.ts`; `vaultRepo.onExternalChange` triggers a full
`reload()` in `VaultContext`. Other tabs converge by reloading the whole snapshot.

`VaultProvider.reload()` seeds `data/seedDemo.ts` when the vault is empty, then runs `sweepCooldowns` —
so cooldown expiry and assignment expiry are applied at load, not on a timer.

## Local-only auth (must not survive the backend swap)

`AuthContext` compares against `demoPassword` from `types/user.ts`, and session restore resolves the
saved id through `demoUserById` — meaning **only the three seeded demo accounts survive a page
reload**; a manager-created user is signed out on refresh. This is a scaffold for the repository swap,
not a bug to patch client-side. Real auth belongs on the server, along with permissions, masking, and
audit — the client checks (`AppUser.can`, the view cap) are UX, not security.

## Conventions

- PascalCase `.tsx` for components; `Context` suffix for providers; domain classes carry `toJson`/
  `fromJson` (defensive: unknown enum values fall back rather than throw).
- Styling is CSS custom properties from `theme/theme.css` (`var(--surface-2)`, `var(--text-secondary)`)
  plus inline styles. No CSS-in-JS, no utility framework.
- Timestamps are ISO strings everywhere, compared with `localeCompare` for sorting.
- Tests sit next to their subject (`logic/dispositions.test.ts`) and cover the logic layer — the
  disposition machine, formatting/masking, and the import pipeline. UI is not unit-tested.
- CRA is deprecated; a Vite migration is an open recommendation in `PORT-PROGRESS.md`, deliberately
  not done to match the team's existing React project.
