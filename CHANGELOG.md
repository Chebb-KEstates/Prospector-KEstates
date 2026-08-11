# Changelog

Every release of Prospector, newest first. This file is updated **in the same
commit** as the change it describes — see
[docs/PROSPECTOR-HANDBOOK.md](docs/PROSPECTOR-HANDBOOK.md) § "Versioning & releases".

Each entry is grouped by type so the impact is obvious at a glance:

- **Added** — a new capability.
- **Changed** — a change to existing behaviour (no data lost).
- **Fixed** — a bug fix.
- **Security** — anything touching auth, masking, the audit trail or access control.
- **Data** — anything that touches stored data (a migration, a dedupe, an import
  rule). These get extra scrutiny; nothing here may lose a user's work.

Version numbers are `MAJOR.MINOR.PATCH` (semantic versioning). See the handbook
for what each part means for Prospector.

---

## [1.12.2] — 2026-08-11

### Fixed
- **The persistence gap behind the duplicate-on-update bug.** `saveProperties`
  updated a unit's displayed location columns but **not its `unit_key`** (the
  identity). So a re-map corrected the *displayed* location while leaving the key
  stale — and the next update, computing the corrected key, couldn't match the
  unit and inserted a duplicate. The upsert now updates `unit_key` too, so a
  re-map actually persists the corrected identity and later updates match it.
  Diagnosed from the local data (import → re-map → update produced two rows per
  unit with the same display but different keys). Guarded by a new end-to-end
  regression test (`import → re-map → update` must not duplicate).

> ⚠️ Data already duplicated by this bug isn't auto-repaired — delete the affected
> data set and re-import it once on the fixed build.

---

## [1.12.1] — 2026-08-11

Two serious data-management bugs fixed, and re-map rebuilt on a solid footing.

### Fixed
- **Rental value no longer lands in the sale field.** The column auto-mapper read
  any header containing "transaction value" / "price" as the **sale** figure
  before the (too-narrow) rental check ran — so `Rental Transaction Value`,
  `Rental Price`, `Rent Value` were mapped to sale (or dropped). Rental value
  columns now map to rent, and sale-value columns still map to sale. Guarded by
  new regression tests.
- **Re-mapping columns no longer creates duplicate units.** A unit's identity is
  built from the community/cluster/building columns, so re-mapping those changed
  the key and the old "update" flow inserted a duplicate instead of correcting the
  existing unit.

### Changed (Data)
- **Re-map is now its own operation, distinct from an update-with-a-file.** It
  re-interprets the data set's *own retained source* with the corrected mapping and
  **fixes the existing units in place**, matched by source position (not by the
  now-changed key). It is *authoritative*: corrected values overwrite the old ones,
  **including clearing a value that was wrong** (e.g. a sale figure that was really
  rent). All broker work — call history, notes, portfolio/assignment state, the
  property's identity for linked records — is **preserved**. If the corrected
  mapping would change how rows group into units (or merge two units into one), the
  re-map stops with a clear message instead of guessing. Verified end-to-end.
- No schema change / no migration. (Re-map uses the retained source, so a data set
  imported before file-keeping must be re-imported once to enable in-app re-map.)

---

## [1.12.0] — 2026-08-10

The Audit section becomes a full **Activity Log** — readable, searchable, and
exportable.

### Added
- **Rich activity feed.** The log now resolves unit IDs to **owner name + unit**
  (community · cluster · number), and merges in the **call records** so each call
  shows the **result selected and the note** the broker wrote — retroactively, from
  your existing history. Reveals show which owner's number was seen, **masked**
  (••••1234). Renamed "Audit Trail" → "Activity Log".
- **More filters & sort.** Filter by **person**, by **date range**, and a
  **free-text search** (owner, unit, note), on top of the action chips. Every
  column header (Time / Person / Action) is now **sortable**.
- **Export to Excel** of the currently-filtered log — one readable row per event.
  Phone numbers are **masked in the export**, keeping the "numbers never leave in a
  file" guarantee intact.

### Changed
- Action filter chips: removed the dead `cap-block`, added `export` and `edit`.

### Notes
- No schema change and no migration — the feed is built by enriching existing
  `audit` and `calls` data at read time, so the richer history covers events you
  already have.

Dead-code cleanup from the removed view-cap and global-lock features, plus a bug
fix found along the way. No behaviour change for brokers or managers.

### Fixed
- The manager's Users list and edit dialog never reflected a broker's saved
  **office-network lock** state — the server sent `ipLocked` but the frontend
  dropped it, so the column always showed "—" and the checkbox always opened
  unchecked. (The lock itself worked server-side; only the display was wrong.)

### Changed
- Removed all dead plumbing left over from the removed daily view cap and the old
  global Wi-Fi lock: the `enforceCap`/`used`/`cap`/`viewCapOverride`/`dailyViewCap`
  /`wifiLockEnabled` fields and the per-reveal view-count query. The reveal is
  unchanged in behaviour — single record, audited.
- Deleted two unused source files (`PropertyDetail.tsx`, `AppTable.tsx`) and two
  unused dependencies (`idb`, `web-vitals`). ~500 fewer lines.

### Data
- Migration **012** drops three now-dead columns: `settings.daily_view_cap`,
  `settings.wifi_lock_enabled`, `users.view_cap_override`. No live code read or
  wrote them. Verified on a fresh database end-to-end.

### Deploy
- After 011, migration **012** runs on the next `npm run migrate`. Deploy the new
  code, then migrate, then restart — so the running server never references a
  dropped column.

---

## [1.11.1] — 2026-08-10

The first release under formal version control. The number is shown on the login
screen and matches both `package.json` files and the git tag `v1.11.1`.

### Added
- Version number is now displayed on the login screen and kept in step with the
  repo (`src/version.ts`, both `package.json` files, git tag).
- Foundational documentation: **PROSPECTOR-HANDBOOK.md** (what the system is, how
  it is built, the non-negotiables, the incident log, the release process) and
  this **CHANGELOG.md**.
- Read-only diagnostic `server: npm run diagnose:units` to inspect unit-key
  collisions before any identity migration is ever run again.

### Fixed
- Property popup: the progress bar moved to the top of the page; the "Property X
  of Y" count now shows genuine progress instead of jumping in random mode;
  "Previous" retraces the unit you actually came from; rapid arrow-key paging no
  longer fired a burst of duplicate view-writes (which could error and sign you
  out); rental split onto two lines; one fixed popup size for every property.

### Changed
- The daily view-cap limit was removed for everyone.
- The office-network (IP) lock is now a **per-broker** switch under Users, instead
  of one global setting.

### Data
- **Reverted the unit identity back to tower + number**
  (`u|community|cluster|building|unit`), matching the data already stored, and
  **removed the unusable migration 010**. The earlier "number-only" identity
  wrongly treated the same unit number in different towers as one unit; on the
  live data (blank building field, tower held in community/cluster) that would
  have deleted ~141 distinct units. No data migration was needed for the revert.
  See the handbook's incident log for the full story.

### Deploy
- Run `cd server && npm run migrate` — this applies migration **011** (the
  per-broker IP lock column) only. Then rebuild the front end and restart the API.

---

## Earlier history (before formal versioning)

Prospector was built in milestones from 2026-07-16. Formal version numbers start
at 1.11.1; the journey up to that point is summarised here (and told in full in
the handbook), grouped by phase.

### Phase 4 — Protect, measure, refine (early Aug 2026)
- Manager can edit a data set (details, price, re-map columns) and export it to
  Excel with feedback + history; import source retained for re-download + in-app
  re-map.
- Manager analytics tables; track data cost on every upload.
- Property popup redesigned into a compact 3-column work surface with a
  two-section call-outcome model.
- Per-broker toggle for the calling dialer.
- Office-network lock enforced on **every request**, not just at login.
- "Team" section renamed to "Report".

### Phase 3 — Real data, safely (late Jul 2026)
- Update-import: refresh an existing data set while keeping the team's work (blank
  cells never erase; changes merge).
- Co-owners: keep every owner on a unit and switch between them in the dialer;
  multiple numbers per owner.
- Assignment timers: neglected units return to the pool automatically.
- Natural unit sorting; UTC-correct time comparisons.

### Phase 2 — Full-stack (mid Jul 2026)
- **Backend foundation**: MySQL schema, shared domain layer, auth, import staging.
- Front end moved onto the backend (IndexedDB removed); server-side pagination,
  masking and audit; the reveal-and-audit transaction.
- Flexible uploads: unmapped columns are kept and rendered as dynamic columns.

### Phase 1 — The port & platform (16–17 Jul 2026)
- Ported the Flutter Prospector app to React/TypeScript.
- Data-table platform (filters, columns dialog, sort, pagination, multi-select).
- Guided dialer (coverflow), manager mission-control home, Control section,
  request/assignment loop, soft-delete users, first test suite.
