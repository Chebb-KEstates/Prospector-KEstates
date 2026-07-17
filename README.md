# Prospector

Internal calling-data platform for a Dubai real-estate team. Managers import and
protect owner/buyer data; brokers work assigned records through a guided dialer.

Full-stack: a React/TypeScript front end and a **Fastify + MySQL** backend that
owns persistence, authentication, permissions, phone masking and the audit trail.

---

## ⚠️ Read this first — data protection

Prospector exists to *protect* expensive owner data. These rules are not optional,
and they are now enforced **server-side**, where a client cannot skip them:

- **Real owner data never enters this repository.** The demo data is entirely
  synthetic. `.gitignore` blocks `*.xlsx` / `*.csv` / `Sample Data/`.
- **Phone numbers are masked by the server.** List responses cannot carry a real
  number — `serializeProperty` has no code path that emits one. The only way to a
  real number is the single-record reveal, which checks the daily cap and writes
  the audit entry *in the same transaction*. No bulk reveal, no export.
- **An identity watermark** (signed-in name + email + date) tiles every screen so
  a leaked screenshot is traceable. Do not weaken it to a fixed label.
- **DNC is permanent** and only a manager can undo it.
- **Users are deactivated, never deleted** — history must stay auditable. There is
  deliberately no delete-user route.
- **`SEED_DEMO_DATA` must be `false` in production.** It is opt-in and refuses to
  seed over a non-empty vault, but it is the one switch that could put synthetic
  owners in a real database.

## Tech stack

| Layer | Technology |
|-------|-----------|
| Front end | React 19 · TypeScript · React Router v6 · Context |
| API | Fastify 4 · TypeScript |
| Database | MySQL 8.4 (InnoDB, utf8mb4) |
| Auth | scrypt · httpOnly session cookies · CSRF double-submit |
| Parsing | `xlsx` (server-side) |
| Build | Create React App (front end) · `tsc` (server) |

## Architecture — the one thing to understand

**The server compiles the front end's own domain layer.** `server/tsconfig.json`
includes `src/types` and `src/logic` directly, so `applyOutcome`, `unitKeyFor`,
`normalizePhone`, `ownerKeyOf` and the import pipelines are *literally the same
code* on both sides. There is no second implementation to drift.

That is why `logic/fileParser.ts` must stay free of browser globals — `saveFile`
lives in `logic/downloadFile.ts` for exactly this reason.

```
src/
  types/     domain models + enums          ← shared with the server
  logic/     dispositions, import pipelines ← shared with the server
  data/      apiClient · api · hooks        (the only place that talks to the API)
  state/     AuthContext · VaultContext · ThemeContext · CallSessionContext
  components/
server/
  src/
    db/            pool · migrations · seed
    domain/        ids · masking
    auth/          password · sessions
    repositories/  SQL, one per aggregate
    services/      transactional logic (assign · calls · reveal · import)
    routes/        HTTP + validation + permission checks
    http/          errors · serializers  ← the masking boundary
e2e/         browser smoke test
```

### Data flow

Tables are **paginated server-side**; there is no full snapshot in the browser.
Consequently:

- Table rows come from `usePropertyPage` / `useLeadPage` (debounced, abortable).
- Dashboard numbers come from `/api/dashboard/*`, aggregated in SQL — the client
  cannot fold over data it doesn't have.
- A broker's own set is bounded, so it still loads whole (`useMyProperties`).
- `VaultContext` keeps only the small, referenced-everywhere collections: users,
  settings, data sets, requests.

## Getting started

```bash
# 1. Database (Docker; port 3307 so it can't collide with a local MySQL)
docker run --name prospector-mysql \
  -e MYSQL_ROOT_PASSWORD=rootpw_local_dev \
  -e MYSQL_DATABASE=prospector \
  -e MYSQL_USER=prospector -e MYSQL_PASSWORD=prospector_local_dev \
  -p 3307:3306 -d mysql:8.4
# afterwards: docker start prospector-mysql

# 2. API
cd server
cp .env.example .env          # set BOOTSTRAP_MANAGER_PASSWORD
npm install
npm run migrate
npm run seed                  # first manager (+ synthetic demo data if enabled)
npm run dev                   # → :4000

# 3. Front end
npm install
npm start                     # → :3000
```

Sign in as the bootstrap manager from `.env`. You'll be forced to change the
password on first sign-in — that's the flow, not a bug.

`REACT_APP_API_URL` overrides the API origin (default `http://localhost:4000`).
Add any new front-end origin to `CORS_ORIGIN` in `server/.env`: credentialed CORS
cannot use a wildcard.

## Scripts

| Command | Description |
|---|---|
| `npm start` / `npm run build` | Front-end dev server / production build |
| `npm test` | Front-end tests (42) |
| `npm run e2e` | Browser smoke test — see `e2e/README.md` |
| `server: npm run dev` | API with reload |
| `server: npm run migrate` | Apply migrations (creates the database if absent) |
| `server: npm run seed` | Bootstrap the first manager; optional synthetic demo data |
| `server: npm test` | Backend tests against real MySQL — see `server/test/README.md` |
| `server: npm run typecheck` | Typecheck the server **and** the shared domain layer |

## Accounts

Accounts are created by a manager, who sets the first password; the user must
change it on first sign-in. There are no demo logins and no shared password — the
reference implementation compared against a `demo1234` string compiled into the
JS bundle that *every* account matched.

## Notes

- CRA is deprecated. A Vite migration is worth doing before go-live; it was
  deliberately not bundled into this migration.
- Backend tests must run serially (`--test-concurrency=1`): they share one
  database and wipe tables.
