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
