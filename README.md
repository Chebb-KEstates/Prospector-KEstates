# Prospector (React)

Internal calling-data platform for a Dubai real-estate team. Managers import and
protect owner/buyer data; brokers work assigned records through a guided dialer.

This is the **React/TypeScript port of the reference Flutter app**, rebuilt to full
UI/UX + feature parity so it can be taken backend-ready and live. It matches the
existing React conventions (Create React App + TypeScript + Context, local-first
`vaultRepository` seam) so it drops straight into that workflow.

---

## ⚠️ Read this first — data protection

Prospector exists to *protect* expensive owner data. These rules are not optional:

- **Real owner data never enters this repository.** The demo data in `src/data/seedDemo.ts`
  is entirely synthetic. `.gitignore` blocks `*.xlsx` / `*.csv` / `Sample Data/`.
- **Phone numbers are masked** on every list surface. The reveal is deliberate,
  single-record, and audited (no bulk reveal, no export).
- **An identity watermark** (signed-in name + email + date) tiles every screen so a
  leaked screenshot is traceable. Do not weaken it to a fixed label.
- **DNC is permanent** and only a manager can undo it.
- **Users are deactivated, never deleted** — history must stay auditable.

## Tech stack

| Layer | Technology |
|-------|-----------|
| Framework | React 19 |
| Language | TypeScript |
| Routing | React Router v6 |
| State | React Context (`AuthContext`, `VaultContext`, `ThemeContext`, `CallSessionContext`) |
| Storage | IndexedDB (`idb`) behind `vaultRepository` — the intended backend swap-in point |
| Parsing | `xlsx` |
| Build | Create React App |

## Getting started

```bash
npm install
npm start        # → http://localhost:3000
```

On first run an empty vault is seeded with **synthetic** demo data so every screen is
populated. To reset, clear the site's IndexedDB in your browser dev tools.

### Demo accounts (password `demo1234`)

| Role | Email |
|------|-------|
| Manager | `director@demo.ae` |
| Broker | `sara@demo.ae` |
| Broker | `omar@demo.ae` |

These one-click demo logins are for local development only — **remove them and the
printed password before any deployment with real data.**

## Architecture

- `types/` — domain models (`Property`, `Lead`, `CallLog`, `AppUser`, …) + the disposition enums
- `logic/` — import pipelines, owner grouping, the disposition state machine
- `data/` — `vaultRepository` (IndexedDB), tab-sync, session store, `seedDemo`
- `state/` — Context providers (the app's data + session API)
- `components/common/` — the design system: `Dash` kit (HeroSlab, StatTile, charts), `Icon`, `StateChip`, `Watermark`, `AppTable`
- `components/manager/` — Dashboard (mission control), Data Vault, Assignments (+ Requests), Team, Control (Import & Files / Users / Audit / Settings)
- `components/broker/` — Home (dash), Today (owners|buyers), Pool, Portfolio, and the coverflow dialer (`CallSessionView` + `CallCard`, `callStops`)

## Next phase: backend

The whole data layer sits behind `data/vaultRepository.ts`. Replacing that one module
with a hosted backend (auth, server-side permissions, audited access, server-side phone
masking) is the go-live path — the UI does not need to change. Keep the data rules above
enforced on the server, not just the client.

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Development server |
| `npm run build` | Production build to `build/` |
| `npm test` | Tests (38 passing — dispositions, masking, import pipeline, dedupe, owner grouping) |
