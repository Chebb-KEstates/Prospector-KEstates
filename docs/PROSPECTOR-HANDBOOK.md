# Prospector — The Handbook

> **This is the master document for Prospector.** If you read only one file to
> understand what this system is, how it is built, the rules it lives by, and how
> we work on it, read this one.
>
> It is a **living document**. Every meaningful change to the app updates it in the
> same breath as the code and the [CHANGELOG](../CHANGELOG.md). A change that isn't
> reflected here didn't really happen.

| | |
|---|---|
| **Current version** | v1.11.1 |
| **Last updated** | 2026-08-10 |
| **Live site** | owners-crm.kestates.ae |
| **Repository** | github.com/Chebb-KEstates/Prospector-KEstates |
| **Companion docs** | [README.md](../README.md) (developer quick-start) · [CHANGELOG.md](../CHANGELOG.md) (release log) · [PORT-PROGRESS.md](../PORT-PROGRESS.md) (the original port) |

---

## Table of contents

1. [What Prospector is](#1-what-prospector-is)
2. [The non-negotiables — our constitution](#2-the-non-negotiables--our-constitution)
3. [How it is built — architecture](#3-how-it-is-built--architecture)
4. [The data model](#4-the-data-model)
5. [The life of the data — upload, edit, export](#5-the-life-of-the-data--upload-edit-export)
6. [How people use it — brokers & managers](#6-how-people-use-it--brokers--managers)
7. [Security & data protection](#7-security--data-protection)
8. [The incident log — what went wrong and how we fixed it](#8-the-incident-log--what-went-wrong-and-how-we-fixed-it)
9. [Versioning & releases](#9-versioning--releases)
10. [The daily format — how we work](#10-the-daily-format--how-we-work)
11. [The journey — how we got here](#11-the-journey--how-we-got-here)
12. [Glossary](#12-glossary)

---

## 1. What Prospector is

Prospector is an **internal calling-data platform for a Dubai real-estate team**.
It exists to do two things well:

1. **Protect expensive owner and buyer data.** Contact lists are the team's most
   valuable, most leakable asset. Prospector makes that data useful to brokers
   *without* letting it walk out the door.
2. **Turn that data into disciplined calling activity** — managers import and
   allocate records; brokers work their assigned records through a guided dialer;
   everyone's activity is measured.

There are two kinds of user:

- **Managers** (the director and team leads) — import data, allocate it, set the
  rules, watch the numbers, manage users.
- **Brokers** — receive assigned units, call the owners through the dialer, log
  every outcome, and build a portfolio of interested owners.

Everything else in this handbook exists to serve those two jobs while never
breaking the protections in §2.

---

## 2. The non-negotiables — our constitution

These are the rules that **must not be broken by future work**. If a new idea
requires breaking one of these, that is not a normal change — stop, and treat it
as a deliberate MAJOR decision (see §9) with the director's sign-off.

### Data protection
- **Real owner data never enters the repository.** Demo data is entirely
  synthetic; `.gitignore` blocks `*.xlsx` / `*.csv` / sample-data folders.
- **Phone numbers are masked by the *server*.** A list response has *no code path*
  that emits a real number. The only way to a real number is the **single-record
  reveal**, which checks the rules and writes the audit entry **in the same
  database transaction**. There is no bulk reveal and no number export.
- **An identity watermark** (the signed-in person's name + email + date) tiles
  every screen, so a leaked screenshot is traceable to a person. Never weaken it
  to a fixed label.
- **DNC (Do Not Call) is permanent**, and only a manager can undo it.
- **Users are deactivated, never deleted** — history must stay auditable. There is
  deliberately no delete-user route.
- **`SEED_DEMO_DATA` must be `false` in production.** It is the one switch that
  could put synthetic owners into a real database.

### The user's work is sacred
- Calls, notes, feedback, portfolios and allocations are **created by the team and
  can never be silently lost.** Imports and updates **preserve** them.
- On an update-import, **a blank cell never erases an existing value.** Blank
  means "no new information", not "delete".

### Identity & data integrity
- **A unit's identity is its tower + number** — `u|community|cluster|building|unit`
  (or `p|community|plot` for plots). The community label alone is *not* the
  identity, and the number alone is *not* the identity either. (See §8 for the
  incident that taught us this the hard way.)
- **Migrations are forward-only and idempotent.** A migration that changes stored
  data is **never run without a read-only diagnostic first** and a plan that
  cannot lose data. We do not "force" a failed migration.

### One implementation, no drift
- **The server compiles the front end's own domain layer.** `applyOutcome`,
  `unitKeyFor`, `normalizePhone`, `ownerKeyOf` and the import pipelines are
  *literally the same code* on both sides. Never fork them into two copies.

### Access
- **The office-network (IP) lock** can restrict a broker to the office's public IP,
  enforced on every request. It is a **per-broker** switch.
- **Passwordless "switch user" login is for local testing only.** It is
  fail-closed: it needs an explicit flag *and* a non-production environment. The
  live site always uses real password login.

---

## 3. How it is built — architecture

### The stack

| Layer | Technology |
|-------|-----------|
| Front end | React 19 · TypeScript · React Router v6 · Context |
| API | Fastify 4 · TypeScript |
| Database | MySQL 8.4 (InnoDB, utf8mb4) |
| Auth | scrypt · httpOnly session cookies · CSRF double-submit |
| File parsing | `xlsx`, **server-side only** |
| Build | Create React App (front end) · `tsc` / `tsx` (server) |

### The one thing to understand

**The back end shares the front end's domain layer.** `server/tsconfig.json`
includes `src/types` and `src/logic` directly, so the rules of the business
(how a call outcome changes a unit's state, how a unit's identity key is built,
how phones are normalised, how owners are grouped) exist **once** and run
identically on client and server. There is no second copy to drift out of sync.

Because of that, the shared logic must stay free of browser-only globals — for
example file *parsing* lives in `logic/fileParser.ts` (pure), while file
*download* lives separately in `logic/downloadFile.ts`.

### Folder map

```
src/
  types/       domain models + enums          ← shared with the server
  logic/       dispositions, import pipelines  ← shared with the server
  version.ts   the app version (single source of truth)
  data/        apiClient · api · hooks         (the only place that talks to the API)
  state/       AuthContext · VaultContext · ThemeContext · CallSessionContext
  components/  broker/ · manager/ · common/ · LoginScreen
server/
  src/
    db/            pool · migrations · seed · diagnostics
    domain/        ids · masking
    auth/          password · sessions · ip-lock
    repositories/  SQL, one per aggregate
    services/      transactional logic (assign · calls · reveal · import · export)
    routes/        HTTP + validation + permission checks
    http/          errors · serializers   ← the masking boundary
docs/          this handbook
e2e/           browser smoke test
```

### How data flows (and why)

Tables are **paginated on the server** — the browser never holds a full copy of
the vault. This is a protection, not just a performance choice:

- Table rows come from paged, debounced, abortable hooks (`usePropertyPage` /
  `useLeadPage`).
- Dashboard numbers are aggregated **in SQL** via `/api/dashboard/*` — the client
  cannot fold over data it was never given.
- A broker's own assigned set is bounded, so it loads whole.
- Shared context (`VaultContext`) holds only the small, everywhere-referenced
  collections: users, settings, data sets, requests.

### Environments

| Environment | Where | Notes |
|---|---|---|
| **Live** | branch `backend-version` → owners-crm.kestates.ae | Fastify API + MySQL. This is the real data. |
| **Local test** | front end `:3000`, API `:4000`, local MySQL | Same code; synthetic data only. Optional passwordless "switch user" for testing. |

**Branch model:** day-to-day fixes are pushed to the **`heinrich`** branch. They
are merged into `backend-version` (the live branch) on a regular cadence and then
deployed. `main`/`master` is not the live branch. **Never push straight to the
live branch.**

---

## 4. The data model

The database is MySQL. Every table is InnoDB/utf8mb4. The schema is created and
evolved only through **numbered migration files** in `server/src/db/migrations/`
(see §9). The important tables:

| Table | What it holds |
|---|---|
| `users` | Managers and brokers. Deactivated, never deleted. Carries role, team, permissions, and the per-broker office-lock flag. |
| `sessions` | Live sign-ins. Only a **hash** of the session token is stored, never the token itself. |
| `settings` | One row of org-wide settings: cooldowns, the assignment-timer values, the office IP. |
| `datasets` | Each uploaded data set: name, source, type, cost, counts, and (retained) original file for re-download/re-map. |
| `properties` | Owner records — the core asset. Owner fields are denormalised on purpose (see below). |
| `leads` | Buyer enquiries — shares the same state machine as properties. |
| `calls` + `call_properties` / `call_leads` | Every logged call and which record(s) it was about. |
| `requests` + `request_units` | A broker's request for pool data and the units in it. |
| `audit` + `audit_properties` | Append-only trail of who did what (reveals, imports, allocations…). |
| `import_sessions` + `import_rows` | Temporary staging while an upload is being mapped. The uploaded file's bytes are parsed then **discarded** — only parsed rows are staged, briefly. |

### The unit identity — the most important key in the system

A property's **identity** — what makes two rows "the same unit" — is built by
`unitKeyFor()` in `src/logic/importPipeline.ts`:

```
u | community | cluster | building | unit      (a unit within a building)
p | community | plot                           (a plot)
```

That readable key is hashed (SHA-256 → `unit_key_hash`), and
`UNIQUE (org_id, unit_key_hash)` is what stops the same unit being stored twice.

**Why the whole location is in the key:** in the real data the *building* field is
frequently blank and the tower/development name lives in the *community/cluster*
fields. So "unit 101" exists in many different towers. If identity were the number
alone, those distinct units would collide and be treated as one — which is exactly
the incident in §8. The tower stays in the identity so different buildings' units
stay distinct.

### Owners and co-owners

Owner details are **denormalised onto the property row** on purpose (a separate
owners table would change dedupe and allocation semantics). A unit can have:

- **Multiple numbers** for one owner (`owner_phones`, a JSON list — Mobile 1 / 2 / 3).
- **Multiple owners** (`owners`, a JSON list — co-owners, each with their own
  number and nationality). The primary owner stays in the flat `owner_*` columns
  so masking, grouping and search keep working untouched.

Owners are grouped dynamically by `ownerKeyOf()` (phone-else-name), not by a
stored owner id.

### The state machine — a unit's life

Every property/lead is always in exactly one **state**:

`pool` → `assigned` → `portfolio` / `cooling` / `dnc`

Transitions are driven by **call outcomes** through `applyOutcome()` in
`src/logic/dispositions.ts`. The outcomes (the enum stored in the database):
`noAnswer`, `unreachable`, `callbackLater`, `interestedSell`, `interestedRent`,
`notInterested`, `alreadyListed`, `dnc`.

The **assignment timer** (values live in Settings) governs how long a broker keeps
a unit before it returns to the pool for someone else:

- A time-to-make-contact SLA when a unit is first assigned.
- Each no-answer resets the clock by a set amount, up to a hard maximum hold.
- Interested units become a **portfolio** hold, renewed by calling or saving notes.
- Setting any timer value to **0** removes that particular limit.

> In the dialer, brokers see the outcome as **two sections** — first *did the call
> connect* (No answer / Didn't connect / Answered), then, only if answered, *what
> was the result* (interested to sell/rent, call back, future interest, not
> interested, living in property, dropped, do-not-call). Those friendly labels are
> mapped onto the stored outcomes above; the strongest selected result drives the
> state, and every ticked label is saved in the feedback.

---

## 5. The life of the data — upload, edit, export

### Uploading (import)

1. A manager uploads an Excel/CSV file. It is parsed **on the server**; the raw
   bytes are never written to disk.
2. The **import wizard** maps the file's columns to Prospector's fields. Auto-mapping
   recognises common vendor headers (Development → master community, a second
   community-like column → sub-community/cluster, Building, Unit, Owner, Mobile 1/2/3,
   nationality, etc.). Anything unmapped is **kept** as a dynamic "extra" column.
3. The mapped rows are **staged** (in `import_sessions` / `import_rows`) so the
   manager can review before committing.
4. On commit, rows become `properties` (or `leads`), keyed by their unit identity.

### Updating an existing data set

Choosing **"Update an existing data set"** merges the new file into the chosen set
rather than creating a new one. The rules that protect the team's work:

- **Blank keeps** — an empty cell never erases what's there.
- **Changes merge** — non-blank cells update the unit in place.
- **Work is preserved** — notes, calls, state, portfolio and allocations survive.
- The unit is matched by its **identity key**, so the same file re-imported lands
  on the same units.

### Editing a data set

A manager can edit a set's **details and price**, and **re-map its columns** — and,
for sets uploaded after the source-retention feature, **re-download the original
file** and **re-map in-app** without re-uploading.

### Exporting

A data set can be exported to **Excel** with the data **plus** call feedback and
the audit history — for reporting or handover. (This is a *data set* export for
managers; it is **not** a bypass of phone masking — see §7.)

---

## 6. How people use it — brokers & managers

### Brokers

- **Home** — a dashboard of their pipeline, how they compare to the team, what's
  due next, a snapshot of the pool.
- **Today** — owners / buyers to work, with quick filters, and "Start calling".
- **Pool** — a *teaser* view (owner hidden until assigned); brokers tick units and
  **request** them; the manager approves or denies.
- **Portfolio** — the interested owners they're nurturing; click a unit to open its
  record.
- **The dialer** — the heart of the broker experience: a rich call card showing
  seller signals, last sale, tenancy and full history; the owner's number is
  **revealed one record at a time** (and audited); the broker logs the outcome and
  feedback, then **Save & next**. Selecting an outcome does not auto-advance.

### Managers

- **Home** — mission control: data composition, momentum, alerts, outcomes,
  coverage, the audit feed, and a broker performance board.
- **Control** — four permission-gated sections:
  - **Import & Files** — the import/update wizards and the data-sets manager
    (edit, price, re-map, export, retain-source).
  - **Users** — create/manage users, soft-delete (deactivate/reactivate), the
    **per-broker office-network lock**, and the **per-broker dialer toggle**.
  - **Audit** — the trail.
  - **Settings** — cooldowns, the assignment-timer values, and the office IP.
- **Assignments** — Pool / Assigned / Requests, with a pending-request badge; the
  allocation loop.
- **Report** — team and data-set analytics (formerly "Team").
- Managers can reveal a full number on the manager tables (audited), and every
  such action is logged.

### The property popup (the shared work surface)

Clicking a unit opens a popup used by brokers and managers alike: one compact box
with the property facts, last-sale and rental (rental glows red when a lease ends
within 100 days), the owner box, auto-saving notes, the two-section call-outcome
control, a last-call pill, and a "randomise next" option. Paging between units
keeps a real history so "Previous" returns to the unit you actually came from.

---

## 7. Security & data protection

This section restates the protections in one place because they are the reason the
product exists.

- **Masking boundary** — `server/src/http/serializers.ts` is the only place list
  data is shaped for the client, and it cannot emit a real phone number.
- **Reveal + audit are one transaction** — you cannot reveal a number without the
  audit row being written; they succeed or fail together.
- **Identity watermark** — every screen is tiled with the viewer's identity.
- **Authentication** — passwords hashed with scrypt; sessions are httpOnly cookies
  with only a hash stored server-side; CSRF is double-submit.
- **Office-network lock** — per broker; when on, that broker is signed out the
  moment they use the app from outside the office's public IP. The office IP is set
  once in Settings; empty means no one is locked. ⚠️ It must be the office's
  **public** IP, and behind a reverse proxy the proxy must forward the real client
  IP — confirm with the host before turning it on in production.
- **DNC** is permanent; **users** are deactivated, never deleted.
- **Dev-login** (passwordless switch-user) is fail-closed and can never be on in
  production.

---

## 8. The incident log — what went wrong and how we fixed it

Recording failures is part of the testament. Each entry: what happened, the root
cause, the fix, and the lesson.

### 2026-08-07 — Migration 010 would have deleted ~141 live units

- **Symptom.** Deploying to the server, `npm run migrate` failed on migration 010
  with `Duplicate entry … for key 'uk_properties_unit'`. Everything had passed
  locally.
- **Root cause.** A recent change had made a unit's identity the **number +
  building** only, on the assumption that the tower lives in the *building* field.
  In the real data the building field is **blank** and the tower/development name
  lives in *community/cluster*. So "unit 101" in Eden House, Royal Atlantis and
  three Palm Jebel Ali fronds all collapsed to the same key and collided. Local
  test data never had that shape, so it passed.
- **Why we did not force it.** Forcing the migration would not have removed
  duplicates — it would have **merged genuinely different units and deleted about
  141 real records** across different towers.
- **How we diagnosed it.** We wrote a **read-only** diagnostic
  (`server: npm run diagnose:units`) that classified every collision as a *genuine
  duplicate* (same building, only the community label differs) versus *different
  buildings that merely share a unit number*. It reported: 114 collision groups,
  all different buildings — **zero** genuine duplicates.
- **The fix.** We **reverted the identity back to tower + number**
  (`u|community|cluster|building|unit`), which matches the data already stored, and
  removed migration 010. No data migration was needed. The server had rolled the
  failed statement back cleanly, so nothing was half-changed.
- **Lessons (now rules in §2).** (1) A migration that changes stored data is never
  forced and never run without a read-only diagnostic first. (2) The shape of the
  *real* data — not the test data — decides whether a change is safe. (3) "Correct
  a mislabelled community without creating a duplicate" is still an open want; it
  will be solved by matching within a data set, **not** by throwing away the tower.

### Earlier fixes worth remembering
- **UTC vs server time.** Time comparisons must use `UTC_TIMESTAMP()` — the app
  stores UTC but the server's `NOW()` is local (+4), which silently skewed timers.
- **Unmasked phones in Assignments.** A hand-rolled manager table once rendered
  real numbers; it was replaced with the shared, masked table. Lesson: never
  hand-roll a data table — reuse the shared, masked one.

---

## 9. Versioning & releases

We use **semantic versioning**: `MAJOR.MINOR.PATCH` (e.g. `1.11.1`). For Prospector:

| Part | Bump it when… | Examples |
|---|---|---|
| **MAJOR** | you change a **fundamental** — the data shape, the unit identity, the permission model, a §2 non-negotiable. Needs the director's sign-off and a data plan. | changing what identifies a unit; a new database structure |
| **MINOR** | you add a **new capability** that doesn't break existing data. | "export a data set", "per-broker dialer toggle", a new report |
| **PATCH** | you make a **fix or polish** that changes no data shape and adds no feature. | a bug fix, a layout tweak, wording |

### Where the version lives (keep these four in step)

1. `src/version.ts` — `APP_VERSION` (what the **login screen** shows).
2. `package.json` (front end) — `"version"`.
3. `server/package.json` — `"version"`.
4. The git tag `vX.Y.Z` on the release commit.

The login screen, the repository, and the local test platform therefore always
report the **same** number.

### Categorise every change

Every change is logged in [CHANGELOG.md](../CHANGELOG.md) under one of:
**Added · Changed · Fixed · Security · Data**. The **Data** category is special —
anything that touches stored data gets extra scrutiny and may never lose a user's
work.

### The release checklist (the data-safety gate)

Before a change is pushed:

- [ ] Both type-checks pass (`npm run typecheck` on the front end **and** the server).
- [ ] Tests pass (`npm test`).
- [ ] If it adds/edits a **migration**: it is forward-only and idempotent, and it
      has been run against a **fresh** database start-to-finish.
- [ ] If it touches **stored data**: there is a read-only way to inspect the impact
      first, and no path that loses a user's work. When in doubt, diagnose, don't
      force.
- [ ] `CHANGELOG.md` has an entry, and the version + `src/version.ts` + both
      `package.json` files are bumped for a release.
- [ ] The change respects every §2 non-negotiable (or is a signed-off MAJOR).

---

## 10. The daily format — how we work

The point of this handbook is that we **build on a structure**, not patch things
together until they happen to work. In practice:

1. **Small, described changes.** Each change is focused, and its commit message and
   CHANGELOG entry say *what* changed and *why*, categorised (§9).
2. **Fundamentals are protected.** If a task would touch a §2 non-negotiable, that
   is a stop-and-flag moment, not a quiet edit.
3. **Diagnose before you change data.** Read-only first; understand the *real*
   data; never force a failed migration. (See §8 for why this rule exists.)
4. **One implementation.** Business rules live once, in the shared domain layer.
5. **Push to `heinrich`; merge to the live branch on cadence.** Never straight to
   live.
6. **The version travels with the code.** Bump it, tag it, show it — so we always
   know exactly what is running on the live site and on the test platform.
7. **Keep this document current.** A change that isn't reflected in the handbook
   and the changelog isn't finished.

---

## 11. The journey — how we got here

Prospector began as a Flutter app and was rebuilt into this React/TypeScript
platform. The milestones (full detail in [CHANGELOG.md](../CHANGELOG.md) and
[PORT-PROGRESS.md](../PORT-PROGRESS.md)):

- **Phase 1 (16–17 Jul 2026) — the port & platform.** The Flutter app was ported to
  React/TS; a full data-table platform, the guided coverflow dialer, manager
  mission-control home, the Control section, the request/assignment loop,
  soft-delete users, and a first test suite were built.
- **Phase 2 (mid Jul 2026) — full-stack.** A Fastify + MySQL backend took over
  persistence, auth, masking and audit; the front end moved off browser storage;
  server-side pagination and the reveal-and-audit transaction landed; uploads
  became flexible (unmapped columns kept).
- **Phase 3 (late Jul 2026) — real data, safely.** Update-imports that keep the
  team's work; co-owners and multiple numbers; automatic assignment timers;
  UTC-correct time handling.
- **Phase 4 (early Aug 2026) — protect, measure, refine.** Data-set edit / price /
  re-map / Excel export / source retention; analytics; the redesigned property
  popup and two-section call outcomes; per-broker dialer toggle; the office lock
  enforced on every request.
- **v1.11.1 (10 Aug 2026) — formal foundations.** The identity incident (§8) was
  resolved, the daily view cap removed, the office lock made per-broker, and — with
  this release — **formal version control, this handbook, and the changelog**.

---

## 12. Glossary

- **Unit / property** — one owner record (an apartment, villa or plot).
- **Unit identity key** — the string that makes two rows the same unit:
  `u|community|cluster|building|unit` or `p|community|plot`.
- **Pool / Assigned / Portfolio / Cooling / DNC** — the states a unit moves through.
- **Reveal** — showing a real phone number for one record; always audited.
- **Masking** — the server hiding real numbers in list responses.
- **Data set** — one uploaded batch of records.
- **Disposition / outcome** — the result of a call, which moves the unit's state.
- **Assignment timer** — how long a broker holds a unit before it returns to the pool.
- **Watermark** — the identity tiling on every screen that makes leaks traceable.
- **Office-network lock** — a per-broker restriction to the office's public IP.
- **Migration** — a numbered, forward-only step that evolves the database.
- **`heinrich` / `backend-version`** — the working branch / the live branch.
