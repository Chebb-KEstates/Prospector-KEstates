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

## [3.18.0] — 2026-09-10

### Changed
- **"Interested" now means the same thing everywhere — a distinct interested
  PROPERTY, never an interested call.** After the Report tables (v3.17.1–3), the
  remaining places that still counted interested *call events* now count distinct
  units that became interested (a transition into interested, counted once each):
  the **prospecting funnel** (manager + broker, every period), the manager
  **daily board's** interested-today column, the **momentum** card, the broker
  home's **interested (all-time)** and today figures, and the **Data-ROI** panel
  — so "cost per interested" is now cost per interested *unit*. Logging two
  interested calls on the same property no longer shows "2 interested" anywhere.
  (The Database's Interested filter is a live snapshot of units interested right
  now, unchanged by design.)

No schema change / no migration — pull + rebuild (server) + restart.

---

## [3.17.3] — 2026-09-10

### Changed
- **Report → Area breakdown: "Interested" is now "New interested", and follows
  the date range.** The area table's interested figure was a lifetime snapshot of
  units whose last outcome is currently interested; it now counts the **distinct
  units in each area that newly *became* interested in the selected period**,
  using the same transition rule as the broker table (a fresh interest counts, a
  follow-up that stays interested does not, a re-interest after any non-interested
  outcome counts, and sell + rent on one unit counts once). So the two tables now
  answer the same question — "how much new interest was generated" — for brokers
  and for areas over the same window. The Database's Interested filter is
  unchanged (it stays a live snapshot of units interested right now).

No schema change / no migration — pull + rebuild (server) + restart.

---

## [3.17.2] — 2026-09-10

### Changed
- **Report "Interested" is now "New interested" — units that newly *became*
  interested in the selected period.** A unit counts when a call in the range
  moves it into interested from a non-interested state; a follow-up that merely
  keeps an already-interested unit interested does **not** count; a unit that
  swings interested → not-interested → interested again **does** count as a fresh
  interest; and logging both "interested to sell" and "interested to rent" on one
  unit still counts it **once**. Any non-interested prior outcome (no-answer,
  callback, not-interested) breaks the streak. Attributed to the broker who made
  the transitioning call. Refines v3.17.1 (which counted any interested call in
  the range).

No schema change / no migration — pull + rebuild (server) + restart.

---

## [3.17.1] — 2026-09-10

### Fixed
- **The Report's "Interested" now counts interested UNITS, not interested calls.**
  It was counting every interested *call* a broker logged, so re-calling the same
  unit (or a unit whose outcome later changed) inflated the number and it didn't
  match the Database's Interested filter. It now counts the **distinct units** a
  broker got an interested outcome on, scoped to the selected date range. The
  dashboard's daily broker board uses the same corrected count. (The prospecting
  funnel stays a call-conversion measure by design.)

No schema change / no migration — pull + rebuild (server) + restart.

---

## [3.17.0] — 2026-09-10

### Added
- **Filter by units WITHOUT contact info.** The data tables' "Callable only"
  checkbox is now a **Contact info** dropdown — Any / Has a number / No number —
  so you can filter to units that have no contact number as easily as those that
  do. Applies to every data table (manager Database, broker Database/Pool).
- Server: `/api/properties` gained a `noContactOnly` filter (the inverse of
  `callableOnly`).

No schema change / no migration — pull + rebuild (server) + restart.

---

## [3.16.1] — 2026-09-10

### Fixed
- **A call can no longer be logged as both "Interested" and "Not interested".**
  On the record popup's outcome chips, "Interested — sell/rent" and "Not
  interested" (incl. "Living in property") are contradictory, so picking one now
  clears the other — they can never both be selected or saved.

Client-only. No schema change / no migration.

---

## [3.16.0] — 2026-09-10

### Added
- **The manager Requests table now shows a per-area breakdown of each request**
  — Community · Sub-community with a unit count for each, plus the total —
  instead of a vague "N communities" label when a broker hand-picks units across
  several areas.
- **Click a request's area summary to open a popup** listing the individual
  requested units (unit, community, sub-community, beds, size, state, owner).
- Server: each request from `GET /api/requests` now carries an `areas` breakdown
  computed from its hand-picked units, and a new `GET /api/requests/:id/units`
  returns those units (manager-only, masked).

No schema change / no migration — pull + rebuild (server) + restart.

---

## [3.15.1] — 2026-09-09

### Fixed
- **Report page hardened against a client/server version mismatch.** If the
  frontend and backend are ever out of step (e.g. the client bundle wasn't
  rebuilt on deploy), the Report's tables now fall back to empty instead of
  crashing the page. (Version bump also serves as a deploy marker — the login
  screen showing this version confirms the new frontend is actually live.)

Client-only. No schema change / no migration. **Deploying only takes effect
once the CLIENT is rebuilt and the browser loads the new bundle.**

---

## [3.15.0] — 2026-09-09

### Changed
- **Dashboard: "Data coverage" is now "Area coverage"** — it shows, per area
  (community · sub-community), how much of that area's callable stock has been
  called, biggest areas first, instead of per uploaded data set.
- **Dashboard broker board now shows "Areas held" by default** — each broker's
  areas + unit counts, matching the Report. (Still customisable via Columns.)

Client-only. No schema change / no migration.

---

## [3.14.0] — 2026-09-09

### Changed
- **The Brokers table now leads with an "Areas held" column** — each broker's
  areas (community · sub-community) with the unit count in each — matching the new
  Area breakdown table. So you can see which areas a broker works and how many
  units in each, not just which upload sheets they hold. The old "Data assigned"
  (data-set) column is still there, one click away in Columns.
- Server: each broker row on `/api/dashboard/team` now carries its per-area
  holdings alongside its per-data-set holdings.

No schema change / no migration — pull + rebuild (server) + restart.

---

## [3.13.0] — 2026-09-09

### Changed
- **The Report's second table is now an "Area breakdown" instead of a data-set
  breakdown.** It lists every area (Community + Sub-community) with the brokers
  holding units there (name + unit count), plus Units, Callable, Assigned, In
  pool, Untouched and Interested per area — so when one uploaded sheet spans
  several areas you can finally see how many of a specific area's units each
  broker holds. Columns are sortable + show/hide/reorderable like every other
  table. (The brokers' "Data assigned" column and the Data-ROI tiles are
  unchanged; per-data-set figures still live on the Control screen.)
- Server: `/api/dashboard/team` now returns per-area stats + a broker×area
  holdings matrix (new `areaBreakdown` / `areaAssignmentMatrix`) in place of the
  per-data-set breakdown.

No schema change / no migration — pull + rebuild (server) + restart.

---

## [3.12.0] — 2026-09-09

### Added
- **The manager Database now has the same quick-filter chips as the broker
  Database** — next to Filters: All · ⏰ Expiring soon · Due follow-up · Never
  called · No answer · Call back later · Interested. ("To call" is broker-only —
  a personal working-list; for the manager "All" clears the quick filter.) They
  sit in the sticky filter bar, combine with the State filter and the rest of the
  filter bar, and clear the current multi-selection when switched.

Client-only. No schema change / no migration.

---

## [3.11.0] — 2026-09-09

### Added
- **In the Activity Log, the Unit is now clickable** — click it to open that
  property's full detail popup (the same record view as the Database), so you can
  review a unit without leaving the log. Prev/next steps through the other units
  referenced on the current page. Entries whose unit no longer exists stay plain
  text. Server: each activity row now carries the first still-existing linked
  property id.

No schema change / no migration — pull + rebuild (server) + restart.

---

## [3.10.1] — 2026-09-09

### Fixed
- **Brokers were being wrongly throttled ("capped") on a busy day.** The rate
  limiter was meant to count requests per user, but it read the user too early
  (before sign-in is resolved on each request) and always fell back to the
  client IP. Since the whole office shares one office IP, the entire team drained
  a single shared budget (300 requests/min, 60 number-reveals/min) — so on a busy
  morning a broker could be blocked with "Too many requests" even though **there
  is no per-day call limit** (that was removed long ago). Now keyed by the
  signed-in session, so each person gets their own budget as intended. Recent
  dashboard auto-refresh made the shared-bucket contention worse, which is why it
  surfaced now. No limits were lowered; login stays rate-limited per IP.

No schema change / no migration — pull + rebuild (server) + restart.

---

## [3.10.0] — 2026-09-09

### Changed
- **The dashboard's broker board now offers the exact same columns as the Report
  broker table** — Data assigned, Assigned, Total call attempts, No answer,
  Answered, Interested, Answer rate, Interested rate, Last call, plus Team,
  Coverage %, Follow-ups due, Days since last call and Calls/day — all
  show/hide + reorderable and click-to-sort. The board's call columns are scoped
  to **today** (the board stays "today"); assignment/coverage are the current
  book, exactly as on the Report. It refreshes live on the same 30s cadence.
- Under the hood the two tables now share one column definition
  (`brokerColumns.tsx`) so they can never drift apart; the board's saved layout
  key was reset (new columns).

No schema change / no migration — pull + rebuild + restart.

---

## [3.9.0] — 2026-09-09

Made the manager dashboard's broker board sortable + customisable, and the
dashboard live.

### Added
- **The daily broker board is now a full table**: click any column header to
  sort (numeric columns sort highest-first on the first click), and a **Columns**
  button to show/hide and drag-reorder columns — remembered per screen, same as
  the Report and Database tables. **Team** is available as an extra column.
- **The dashboard refreshes itself live** — it re-fetches every 30 seconds while
  the tab is open (and the moment you switch back to it), updating the numbers in
  place with no flicker and no reload. A small **● Live** marker sits by the
  funnel's period selector. Chosen deliberately over WebSockets/streaming: no new
  server infrastructure, nothing to break in the proxy, and 30s is effectively
  live for a calling floor.

### Changed
- The broker board's sort/column behaviour now comes from a **shared
  `AnalyticsTable`** (extracted from the Report), so the board, the Report broker
  table and the Report data-set table all behave identically — and the Report
  tables gained click-to-sort in the process.

No schema change / no migration — pull + rebuild + restart.

---

## [3.8.0] — 2026-09-08

Made the manager Report date-range aware and reworked the broker columns.

### Added
- **Date-range selector on the Report** (Today / Yesterday / Last 7 days /
  Last 30 days / Custom range / All time, default Last 30 days). The broker
  table's **call columns follow the selected range**; assignment & coverage
  columns stay a snapshot of the current book (the app keeps no history of who
  held what on a past date), and the data-set table + Data-ROI are all-time —
  each section is labelled so the timeframe is never ambiguous.
- **Four new broker columns** (show/hide + reorderable, hidden by default):
  **Coverage %** (of a broker's callable held units, how many they've called),
  **Follow-ups due**, **Days since last call**, and **Calls/day** (in range).
- Server: `/api/dashboard/team` accepts `from`/`to`; new per-broker
  `callableCoverageByBroker` and `followUpsDueByBroker` queries.

### Changed
- The broker table's default columns are now **Data assigned, Assigned,
  Total call attempts, No answer, Answered, Interested, Answer rate,
  Interested rate, Last call** (in that order). "Reached" is relabelled
  **Answered**, "Calls" is **Total call attempts**, and **No answer** is now
  attempts − answered so the two reconcile.
- Removed the fixed **Calls 7d / Calls 24h** columns — the range selector
  supersedes them, and mixing timeframes in one row was confusing.

No schema change / no migration — pull + rebuild + restart.

---

## [3.7.0] — 2026-08-27

Widened what the data tables can show and filter on — every field added here was
already stored, just not surfaced.

### Added
- **New filters** (in the Filters popover, all tables, manager and broker):
  - **Property type** — filter to Villa / Apartment / Townhouse… (you could already
    see and sort the Type column, but not filter by it).
  - **Last-sale price (AED)** — a min–max band, so "last sold 2–5M" is one query
    (previously "Purchased between" filtered by date only).
  - **Size (BUA, sqft)** and **Plot size (sqft)** — min–max bands.
  - **Follow-up** — has a follow-up scheduled, or one due now (managers previously
    had no follow-up filter; brokers keep their quick chip).
  - **Has a note** — only units someone's written a note on.
- **New columns** (opt-in via the Columns picker; defaults unchanged):
  - **Nationality** — you could filter by it but not see it in a column.
  - **Attempts** — how many times the owner's been called.
  - **Assigned on** — when the unit went to its current broker.
  - **Added** — when the record entered the vault.
  - **Notes** — shows the note text (truncated, full text on hover); hidden in the
    broker pool teaser like the other owner columns.
- Server: `/api/properties` gained the matching filters and a `property_type`
  facet; the new columns are sortable. No schema or data change.

No migration — deploy is pull + rebuild + restart.

---

## [3.6.1] — 2026-08-26

### Changed
- The prospecting funnel's **second metrics line** (on both the manager and
  broker home) is now **evenly spaced and centred** — equal-width, centred tiles
  that fill the card's width, echoing the funnel's own even columns above them,
  instead of being bunched to the left with empty space on the right.

---

## [3.6.0] — 2026-08-26

Redesigned the broker home to match manager mission control — funnel-led, one
organised screen.

### Added
- **Every broker now has their own prospecting funnel** at the top of their home:
  My list → Called → Reached → Interested, with the drop-off % between stages and
  a **Today / This week / This month** selector for the calling stages. A stat row
  underneath carries the day's supporting numbers (no answer, callable, owners,
  due follow-ups, expiring soon, pool, pending requests, all-time interested).
- Server: the broker dashboard endpoint (`/api/dashboard/broker`) now returns a
  per-broker `funnel` block for today / week / month — the broker-scoped
  counterpart of the manager funnel, so a broker still never sees team numbers.

### Changed
- The broker's metric cards (Running out of time, Your pipeline, You vs the team,
  Due next, Pool snapshot, Coach's corner) are now **uniform height and scroll**
  when their lists are long — the same tidy grid as the manager screen, instead of
  the old ragged, truncated cards. The hero band drops its number strip (those
  figures moved into the funnel row) and keeps just the greeting and shortcuts.

No data or schema change — deploy is pull + rebuild + restart.

---

## [3.5.0] — 2026-08-25

Fixed a manager workflow flaw around "interested" calls.

### Fixed / Added
- **A manager logging an "interested" call now asks who works the owner** instead
  of silently settling it into a portfolio (or, on a pool unit, creating an
  orphaned portfolio with no broker). The dialog:
  - offers a **broker picker** defaulting to the unit's **current holder**;
  - **Assign & save** → assigns that owner's **whole same-area group** to the
    chosen broker (so it's never split), then logs the interested call — the unit
    lands in that broker's portfolio;
  - **Keep in pool** → logs the interest on the record but leaves the unit **in
    the pool, unassigned** (new manager-only `keepInPool` on the call API, which
    records the outcome without applying the disposition).
- **Brokers are unaffected** — their own "interested" call saves straight through
  to their portfolio as before.

### Notes
- No schema change and no migration. Guarded by new server tests (keep-in-pool
  leaves the unit pooled; assign-then-interested lands it in the chosen broker's
  portfolio with the group).

---

## [3.4.3] — 2026-08-25

### Changed
- **Restyled the call-session progress banner** (shown when paging through units in
  the record popup) to match the app: a **rounded floating panel** with a border,
  soft shadow and proper padding, the counts as clean divider-separated stat tiles
  (Made · Answered · No answer · Answer rate) with uppercase micro-labels and the
  champagne progress bar. It now stacks above the popup instead of a hard top bar,
  so it never overlaps the box.

---

## [3.4.2] — 2026-08-25

### Changed
- **Removed the broker app's top bar** that just repeated the current page name.
  The broker now goes straight to the page like the manager app does — the sticky
  page header already carries the title.

---

## [3.4.1] — 2026-08-25

### Changed
- **Polished the data-table headers.** The sticky page header + filter bar now read
  as one clean toolbar panel: **rounded corners**, a full border, **generous side
  padding** (nothing sits flush against the edge any more) and a soft shadow that
  lifts it above the scrolling rows. The manager and broker pages now use the exact
  same header styling.

---

## [3.4.0] — 2026-08-25

Slimmer, sticky, uniform headers on the data-table pages.

### Changed
- **The page header is now sticky too**, above the table's (already sticky) filter
  bar — so the title, view toggle and page actions stay pinned while the list
  scrolls. Both bands stack cleanly (the filter bar offsets below the measured
  header height).
- **Page actions moved up into that header**, and the design is slimmer and the
  same for managers and brokers:
  - **Database** — the *Property owners / Buyer leads / Requests* toggle and the
    manager's *broker picker · Assign · Reclaim* now live in the header (no more
    separate action card). The broker's owners/leads switch matches.
  - **Pool** — the "Tick the units you want…" prompt, the note field and the
    **Request** button are now the sticky header.

---

## [3.3.2] — 2026-08-24

### Changed
- **The middle dashboard cards are now all the same height**, and their content
  **scrolls inside** when there's more to see (e.g. a long alerts or activity
  list) — so the grid stays tidy instead of one card stretching the row.

---

## [3.3.1] — 2026-08-24

### Changed
- **Removed the bars under the funnel numbers.** The prospecting funnel now shows
  just the figures and labels stepping across, with the drop-off % between stages
  — cleaner, and no more clamped mini-bars.

---

## [3.3.0] — 2026-08-24

The manager Dashboard, redesigned around a prospecting funnel.

### Added
- **A prospecting funnel** leads the screen: **Total units → Assigned → Called →
  Reached → Interested**, with the drop-off % between stages. A **period selector**
  (Today / This week / This month) drives the calling stages, and a supporting row
  shows No answer (for the period), Active brokers, Pool, Callable, Owners, Buyer
  leads, Communities and Data sets.
- Server: `/api/dashboard/manager` now returns a `funnel` block with per-period
  (today / 7d / 30d) calls, reached, no-answer and interested counts.

### Changed
- **The whole dashboard is tighter and more balanced.** The scattered stat tiles
  and the separate "database" card are folded into the funnel; the rest — Pipeline,
  Momentum (14-day chart + answer/interest rates), Needs attention, Data coverage,
  Latest activity — sit in one filling grid, with the broker board beneath, so the
  open gaps are gone and it reads as one designed screen.

### Notes
- No schema change and no migration (the funnel is aggregated at read time).

---

## [3.2.1] — 2026-08-24

### Changed
- **The broker's quick-filter chips now sit in the sticky header**, next to the
  Filters button — To call, All, Expiring soon, Due follow-up, Never called, No
  answer, Call back later, Interested. They were a separate row above the table;
  now they stay pinned with the rest of the filters while the list scrolls.
  (Added a generic `headerExtra` slot to the table's sticky header for this.)

---

## [3.2.0] — 2026-08-24

Data tables: a sticky, compact filter header.

### Changed
- **The filter bar now stays pinned** at the top while the rows scroll underneath
  — on every data table, for every user (owners and leads).
- **The owner table's filter bar is far more compact.** Search and State stay
  inline; everything else — Community, Sub-community, Bedrooms, Nationality, Last
  outcome, Assigned-to, Tenancy, Last call, **Purchased (from–to)**, and Callable
  — folds into a single **"Filters" popover** with a count of how many are active,
  so the bar is thin and nothing is forgotten. The Purchased date range is now a
  tidy from–to pair inside that popover instead of two wide inputs on the bar.

### Notes
- Making the **column headers** stick under the filter bar too needs a change to
  how the table scrolls (a bounded-height scroll region) — a possible follow-up.

---

## [3.1.2] — 2026-08-24

Follow-ups from the audit.

### Added
- **Assign now asks to confirm.** Assigning selected units from the Database page
  shows a short confirmation naming the broker and warning that each owner's area
  group moves together — so a manager never silently pulls another broker's owner.

### Removed
- **The vestigial "Use the calling dialer" permission.** The dialer was removed in
  v2.1.0 and nothing reads this permission; it's gone from the model and no longer
  granted to new brokers. Existing brokers' stale copy is ignored on load (no
  migration needed).

### Fixed
- **The Database multi-select now clears when you change a filter**, so an
  Assign / Reclaim can't act on rows you selected under a different filter and can
  no longer see.

---

## [3.1.1] — 2026-08-24

Audit pass — a broken production build fixed, dead code removed.

### Fixed
- **The production build (`CI=true npm run build`) was failing.** Dead imports left
  in `ManagerShell` (8, incl. the now-merged Vault/Assignments screens) and
  `VaultContext` (2) tripped "warnings treated as errors" and stopped the build
  from compiling. Removed them; the build now compiles cleanly.

### Removed
- Two dead component files that nothing imported: `broker/HomeTab.tsx` and
  `broker/OwnerScreen.tsx`.

### Changed
- Two leftover "portfolio" labels the v2.5.0 hide missed: the manager Users list
  no longer shows an "in portfolio" tile, and the "interested owners going stale"
  alert no longer says "in portfolios".

---

## [3.1.0] — 2026-08-24

The manager's **Data Vault** and **Assignments** are now one page: **Database**.

### Changed
- **One "Database" page** replaces the two separate tabs. It opens on the owner
  table with the **full filter bar** — so filtering by **State** shows just the
  pool, or just the assigned units, doing the job the old Pool / Assigned tabs
  did — plus the **Assigned-to** column, **multi-select**, and one action bar with
  **Assign to broker** and **Reclaim to pool**. A top toggle switches between
  **Property owners**, **Buyer leads**, and **Requests** (with its pending badge).
  Everything both pages did now lives in one place; nothing was dropped.
- The Dashboard's shortcuts and alerts point at the merged page.

### Notes
- No schema change and no migration. Assign / reclaim / requests still require the
  "Assign & reclaim" permission (the action bar and Requests toggle are hidden
  without it); the page shows for anyone who could see either old tab.

---

## [3.0.0] — 2026-08-24

**A fundamental rule, enforced through the whole lifecycle: an owner's units in
one area are ONE indivisible group** (director-approved — a MAJOR release). Two
brokers can never work the same owner in the same area, and the group never
fragments. A *different* area of the same owner may still sit with a different
broker — that separation is by design.

### Changed (assignment & timer fundamentals)
- **Reassigning one unit reassigns the whole group.** A manager giving any of an
  owner's same-area units to a broker now moves **every** same-area unit of that
  owner to them — from the pool *and* from any other broker. (Replaces v2.7.0's
  refuse-and-reclaim: the manager's move now just carries the whole group.)
- **Reclaiming one unit reclaims the whole group** back to the pool together.
- **The auto-return timer is now owner-level.** Working *any* unit of the owner
  keeps the **whole same-area group** with the broker; the group only returns to
  the pool once the broker has left the **entire owner** untouched past the
  deadline — and then the whole group returns **together**. A neglected sibling
  no longer peels off on its own.
- **"Do not call" applies to the whole owner (in that area).** Marking one unit
  DNC marks every same-area unit of that owner DNC — held or pooled — so no one
  calls that owner again about any of their properties there.

### Security / Data integrity
- Brokers still cannot poach: a **request** can't be approved for an owner already
  held by another broker (those units are skipped from the grant).

### Notes
- **No schema change and no migration.** All of this is enforced inside the
  existing assignment / call / sweep transactions (locked `FOR UPDATE`). The
  sweep now recycles properties at the group level; leads are unchanged
  (one lead = one person). Guarded by a new server suite (`ownerCohesion.test.ts`)
  run against an isolated scratch DB: reassign-moves-group, reclaim-moves-group,
  owner-wide DNC, and the sweep keeping vs. recycling a group.

---

## [2.7.0] — 2026-08-24

**One owner, one broker — per area — is now enforced, not just intended.**

### Security / Data integrity
- **An owner's units in the same area can no longer be split across two brokers.**
  Assignment always *grouped* an owner's same-area pool units onto one broker, but
  nothing stopped a sibling that later lapsed back to the pool from being handed to
  a **different** broker — leaving two brokers cold-calling the same owner. Now the
  assignment gate refuses it:
  - **Manual assign** rejects with a clear message ("<Owner> is already assigned to
    <Broker> in <area> — reclaim their units first, or assign to <Broker>") if any
    of the owner's same-area units are already held (assigned / portfolio / cooling)
    by another broker.
  - **Request approval** silently **skips** any granted unit whose owner is already
    held by another broker in that area — the requester still gets everything else.
  - A **different area** of the same owner may still go to a different broker — that
    separation is by design (different brokers work different areas).
- Guarded by a new server integration test (an owner's same-area unit is refused to
  a second broker; the holding broker can still take it; a different-area unit of the
  same owner can go to another broker).

### Notes
- No schema change and no migration — a check inside the existing assignment
  transaction (locked `FOR UPDATE`, so concurrent assigns serialise). Pairs with the
  v2.6.0 popup list, which makes an owner's other units visible and requestable.

---

## [2.6.0] — 2026-08-24

See the whole owner — across areas and brokers — from the record popup.

### Added
- **"This owner's other properties" on the record popup.** When you open an
  owner you're working, the popup now lists every *other* unit that owner holds
  — in other areas, with another broker, or loose in the pool — each with its
  **area label** and status:
  - **With <broker>** if a colleague holds it (so you know who to coordinate with),
  - **Not assigned** with a **Request** button if it's in the pool — one click
    sends it to the manager through the normal approval loop (it does not
    self-assign).
  This keeps the deliberate rule that assignment only groups an owner's units in
  the **same area** (so an out-of-area unit stays available to the broker who
  works that area), while making the full picture visible and the loose units
  easy to pull in.

### Notes
- No schema change and no migration. A new read-only endpoint
  (`/owner-holdings`) lists the owner's units (area, state, holder — no phone
  numbers); the Request button reuses the existing hand-picked request flow.
- This does **not** yet hard-prevent a same-area sibling that lapses back to the
  pool from being taken by a *different* broker — it makes it visible and
  re-requestable. A stricter owner guard remains available if wanted.

---

## [2.5.0] — 2026-08-21

"Portfolio" is hidden from the interface — **reversibly**, without touching the
engine or any stored data.

### Changed
- **Portfolio is no longer shown as a separate concept.** After the Portfolio
  page was removed (v2.3.0), the state still surfaced in chips, filters and
  dashboards. Now:
  - units in the portfolio state read as **"Assigned"** everywhere (one change in
    `StateChip`, so it covers every table, popup and timeline);
  - **"Portfolio" is gone from the State filter** dropdown;
  - the broker Home and the manager mission-control dashboards **fold portfolio
    into "Assigned"** (pipeline segments and stat tiles);
  - the **Report**'s Assigned column now counts assigned + portfolio, and its
    Portfolio column is removed;
  - the two Settings timers were renamed from "Portfolio …" to **"Interested-unit
    …"** (they still tune the same, now-hidden, keep-interested behaviour).
  - Interested owners are still found via the Database **Interested** filter.

### Notes
- **The engine is untouched and this is fully reversible.** Interested calls still
  move a unit into the portfolio state internally (it just displays as
  "Assigned"); no schema change, no migration, no data rewrite. Say the word to
  bring the label back, or to retire the state for real.

---

## [2.4.0] — 2026-08-21

Two more filters on the Database list.

### Added
- **"Call back later" quick chip.** One tap to show the units the broker parked
  for a callback (last outcome = call back later) — distinct from "Due follow-up",
  which only fires once the follow-up *date* has arrived.
- **"Called" period filter.** A dropdown beside Tenancy: **Today · Yesterday ·
  This week · Last week · This month · Last month** — to review what's been worked
  in a window. The period's exact bounds are computed from the broker's **local**
  calendar (week starts Monday), so the edges follow their day, not the server's.
  It matches on a unit's most recent call (`last_called_at`).

### Notes
- No schema change and no migration — both are read-time filters over data you
  already have. ("Lease ending" and "Vacant" weren't added as chips — they're
  already in the **Tenancy** dropdown.)

---

## [2.3.0] — 2026-08-21

Call-feedback and the broker's Database list, sharpened.

### Added
- **"Agent" call-feedback option.** On an answered owner call the broker can tick
  **Agent** when they reached an agent rather than the owner. It's recorded on the
  call like any other result but keeps the unit in play (no cooldown), and it
  needs **no call-back date** — the follow-up picker only shows for "Call back
  later" / "Possible future interest".
- **"All" and "To call" views on the Database list.** The broker's list now leads
  with two state views: **To call** (the default — the actionable set: assigned +
  portfolio) and **All** (everything they still hold, *including* cooled-off and
  do-not-call units). Marking a unit "Do not call" / "Not interested" no longer
  makes it vanish for good — it's still there under **All**. The other chips
  (Expiring, Due, Never called, No answer, Interested) work the actionable set.

### Changed
- **The journal and unit history now show every ticked result**, not just the
  single strongest one. If a broker ticked "Interested — sell" *and* "Call back
  later" *and* "Agent", all three show as chips (tinted by the call's outcome),
  with their free-text feedback beneath. Applies everywhere calls are listed —
  the record's History Journal, the property detail dialog, and the manager
  timeline — and reads back over calls you already logged.
- **Removed the broker's Portfolio tab.** Its units are the "Interested" ones,
  reachable from the Database list's **Interested** filter, so the separate page
  was redundant. (No data touched — the portfolio *state* is unchanged; only the
  navigation tab is gone.)

### Notes
- No schema change and no migration. "All" widens the broker's own view to the
  states they already hold; owner scope is unchanged, so a broker still only ever
  sees their own units.

---

## [2.2.0] — 2026-08-18

The **Report** screen now shows who holds what, both ways.

### Added
- **Brokers table — a "Data assigned" column.** Each broker row now lists the
  data sets that broker is currently holding units of, one per line, with the
  unit count beside each (biggest first). A dash when the broker holds nothing.
- **Data sets table — an "Assigned brokers" column.** Each data-set row now lists
  the brokers currently holding units of that set, one per line, with the unit
  count beside each. So you can read it either direction — pick a broker to see
  their data, or pick a data set to see who's on it.

### Notes
- "Currently assigned" means units a broker is actively holding — assigned to
  them or saved in their portfolio. Both lists come from one query, so they
  always agree.
- No schema change and no migration — computed at read time from the units'
  current holdings. Both new columns are show/hide-able like every other column
  (the two Report tables reset to their default column layout once on this
  release so the new columns appear).

---

## [2.1.0] — 2026-08-12

Broker workflow simplified; two UI fixes.

### Removed
- **The flipping "calling session" dialer is gone.** Brokers now work owners
  straight from the **Database** table — click a unit to open the record popup
  (reveal · call · outcome · notes · history) and page through units with ← / →.
  Removed the coverflow calling session, its "Start calling" buttons, and the
  session machinery (`CallSessionView`, `CallSessionContext`, `CallFlow`). The
  shared call types moved to `state/callTypes.ts`. The buyer-lead single-call
  dialog is unchanged.
  - Note: the per-broker "Use the calling dialer" permission is now unused (nothing
    gates on it). Left in place for now — say the word to remove it and its toggle.

### Fixed
- **Account menu** now opens **directly above the profile icon** (it used to appear
  in the top-right corner), and the profile icon is **centred** in the sidebar.

### Changed
- **Broker Pool columns** are now a fixed, focused set: Unit, Beds, BUA, Plot, Type,
  Last transaction, Tenancy, Last call, Outcome, State, Floor. The rest are removed
  from the pool's column picker.

---

## [2.0.0] — 2026-08-12

**A change to the fundamentals: how a unit is identified** (director-approved — a
MAJOR release per our versioning rule). This is the definitive fix for units
duplicating when an area is re-uploaded with the location columns mapped
differently.

### Changed (Identity)
- **A unit's identity is now `community + most-specific tower + unit number`**
  (previously the exact community + sub-community + building + number). The "tower"
  is the building when given, otherwise the sub-community — so the same physical
  unit keys the **same** whether the tower name ("Eden House The Canal Townhouses")
  is mapped into the *building* or the *sub-community* column. Re-uploading an area
  with a different mapping now **matches the existing units instead of duplicating
  them**. Different towers (different building/cluster) and different areas
  (different community) stay distinct.
  - Trade-off (accepted): two *different* buildings in the *same* community must not
    share the exact same name, or they'd be treated as one. Real tower names are
    specific enough.
- **Updates match by recomputed identity, from the actual columns** — so this works
  on units already in the app, with **no migration**. An update loads the target
  set's units and matches them by their tolerant identity, independent of the key
  stored at import time (which may predate this change).

### Notes
- No migration and no data rewrite. Existing keys are left as-is; matching
  recomputes the tolerant identity from the location columns.
- Duplicates already created by the earlier bug are **not** auto-merged — delete
  the affected data set and re-import it once on this build to start clean.
- Guarded by new tests: identity tolerance (building vs sub-community), different
  towers stay distinct, and an end-to-end "update with a different mapping doesn't
  duplicate" (including a legacy stored key).

---

## [1.13.0] — 2026-08-11

### Added
- **Data-set updates now leave a trace in the record's History Journal.** When an
  update changes a unit, a per-unit entry is written to that unit's history —
  headlined by the important case, **an owner change** ("Owner changed: John Smith
  → Jane Doe"), and also flagging a new sale, a rental change, or updated details.
  Previously an update silently changed the record with nothing in the journal, so
  a broker had no way to know (e.g.) that the property had sold and the owner was
  now someone else. These entries also appear in the **Activity Log** under a new
  `update` filter, with the owner + unit resolved.

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
