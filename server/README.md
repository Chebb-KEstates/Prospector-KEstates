# Prospector API

Fastify + TypeScript + Prisma (MySQL) backend for the Prospector CRM. It replaces the
original frontend-only IndexedDB persistence while preserving 100% of the app's behaviour.

## Architecture & key decisions

- **The repository seam is the contract.** The React app persists everything through one
  interface (`src/data/vaultRepository.ts`). This API mirrors those operations 1:1, and the
  frontend's `ApiVaultRepository` returns the exact same JSON shapes the models already parse
  (`*.fromJson`). Nothing above that seam changed.
- **Timestamps stored as strings.** Every ISO/date-ish field is a `VARCHAR` holding the exact
  text the client produced. The app sorts and compares these lexically (e.g. `updatedAt`,
  `cooldownUntil`), so a byte-identical round-trip is required — do **not** convert them to
  `DATETIME`.
- **Business logic stays where it already works.** The disposition state machine, import
  pipelines and owner grouping are deterministic and already correct on the client. The server
  is authoritative for **persistence, auth and authorization**; it does not re-derive those
  calculations, which keeps behaviour identical and avoids drift.
- **Auth.** Per-user bcrypt password hashes; JWT issued in an httpOnly cookie; `/api/auth/me`
  restores the session. Login error copy matches the original `AuthContext` verbatim. Admin
  endpoints are guarded by the same permissions the UI uses (`manageData`, `assignData`,
  `manageUsers`, `editSettings`).
- **Cross-device sync.** A single revision counter (`meta.rev`) is bumped on every mutation;
  the SPA polls `GET /api/vault/rev` and reloads when it changes (localStorage still covers
  same-browser tabs). Writes return the new `rev` so a client never reloads on its own change.
- **Security.** helmet, rate-limiting (global + strict on login), JSON-schema validation on
  every route, parameterised queries via Prisma, secrets from env only.

## Layout

```
src/
  config.ts            env-driven config
  db.ts                Prisma client singleton
  domain/              constants + JSON <-> row mappers (match the frontend shapes)
  auth/                bcrypt + JWT-cookie plugin + permission guards
  store.ts             persistence helpers + revision bump
  routes/              auth, vault (snapshot/rev), data (all writes), users
  index.ts            Fastify bootstrap (helmet, cors, rate-limit, error handler)
prisma/
  schema.prisma        MySQL schema
  migrations/          0001_init
  seed.ts              demo users (demo1234) + default settings + rev row
```

## Endpoints

| Method | Path | Purpose | Guard |
|---|---|---|---|
| POST | `/api/auth/login` | Sign in, set cookie | rate-limited |
| POST | `/api/auth/logout` | Clear cookie | — |
| GET | `/api/auth/me` | Current user | auth |
| GET | `/api/vault` | Full snapshot | auth |
| GET | `/api/vault/rev` | Revision probe | auth |
| POST | `/api/imports/properties` | Commit property import | `manageData` |
| POST | `/api/imports/leads` | Commit lead import | `manageData` |
| PUT | `/api/properties` | Bulk save (assign/reclaim/call/sweep) | auth |
| PUT | `/api/leads` | Bulk save | auth |
| POST | `/api/calls` | Log a call | auth |
| POST | `/api/requests` | Submit request | `requestData` |
| PUT | `/api/requests/:id` | Approve/deny | `assignData` |
| PUT | `/api/settings` | Update settings | `editSettings` |
| POST | `/api/audit` | Append audit entry | auth |
| DELETE | `/api/datasets/:id` | Delete dataset + cascade rows | `manageData` |
| POST/PUT/DELETE | `/api/users[...]` | User CRUD + set-password | `manageUsers` |

## Bugs fixed during migration (behaviour-preserving)

- **Dataset↔rows id mismatch** — the import wizards generated a different `ds-*` id for the
  dry-run rows vs. the committed dataset, so `deleteDataset` orphaned every row. A single id is
  now threaded through, and the server also deletes authoritatively by `datasetId`.
- **Session restore** — refresh restored only the 3 hard-coded demo users; non-demo users were
  logged out. Session is now restored server-side via the cookie + `/me`.

See `.env.example` for configuration.
