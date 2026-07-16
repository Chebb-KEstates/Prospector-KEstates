# Features

- **Data Vault** — Central repository of properties, leads, call logs, and import datasets, persisted in MySQL via the API and shared across devices and sessions
- **Import Wizards** — Step-by-step CSV/XLSX import for property and lead data with column mapping, header detection, and review
- **Owner Grouping** — Automatically groups properties/leads by shared phone numbers into unified owner profiles
- **Call Session** — Carousel-based dialing interface with disposition logging and cooldown management
- **Disposition State Machine** — Tracks property state (cold, warm, hot, callback, sold, dead, DNC) through configurable outcomes
- **Assignment Engine** — Bulk-assign units to brokers with owner-linked automatic expansion
- **Request/Approve Workflow** — Brokers request assignments or ownership transfers; managers approve or deny
- **Daily View Caps** — Enforce per-broker daily view limits with optional override per user
- **Audit Trail** — Every action is logged with timestamp, actor, and detail
- **Live Sync** — Changes are reflected in other tabs instantly and on other devices via server-revision polling
- **Champagne Noir Theme** — Dark and light mode with a refined, professional design system

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18/19 + TypeScript, React Router v6, Create React App |
| Backend | Node.js + **Fastify** + TypeScript |
| Database | **MySQL 8** via **Prisma** ORM |
| Auth | Per-user bcrypt-hashed passwords, JWT in an httpOnly cookie |
| Parsing | `xlsx` (Excel) + a built-in CSV parser (client-side) |
| Delivery | **Docker Compose** (MySQL + API + nginx-served SPA) |

Persistence now lives entirely in MySQL behind a REST API. The SPA keeps
`localStorage` only for the theme preference and same-browser tab-sync signalling;
no application data is stored in the browser.

## Getting Started

### Option A — Docker, with a bundled MySQL container

```bash
cp .env.example .env   # review/adjust secrets & ports
docker compose -f docker-compose.yml -f docker-compose.local-db.yml up --build
```

- App: [http://localhost:3023](http://localhost:3023)
- API: [http://localhost:4023](http://localhost:4023) (also proxied at `/api` by the web container)

The API container automatically applies migrations and seeds the demo accounts on start.

### Option B — Docker, against an existing MySQL server

Use this when deploying somewhere that already has MySQL running (no need to
run a second MySQL container).

```bash
cp .env.example .env
# Point DATABASE_URL at your existing server, e.g.:
#   DATABASE_URL=mysql://user:password@your-db-host:3306/prospector
docker compose up --build
```

This starts only `server` and `web` — no `db` container. Same ports as above.

### Option C — Local development (no Docker for the frontend/backend)

```bash
# 1. Start MySQL (bundled container, or point at your own)
docker compose -f docker-compose.yml -f docker-compose.local-db.yml up -d db

# 2. Backend
cd server
cp .env.example .env          # DATABASE_URL points at localhost:3307 by default
npm install
npx prisma migrate deploy
npm run seed
npm run dev                   # API on http://localhost:4023

# 3. Frontend (separate terminal, repo root)
npm install
npm start                     # http://localhost:3023, proxies /api -> :4023
```

### Demo Accounts

Password for all demo accounts: `demo1234`

| Role | Email |
|------|-------|
| Manager | `director@demo.ae` |
| Broker | `sara@demo.ae` |
| Broker | `omar@demo.ae` |

### Scripts

Frontend (repo root):

| Command | Description |
|---------|-------------|
| `npm start` | Start development server (proxies `/api` to the backend) |
| `npm run build` | Build for production to `build/` |

Backend (`server/`):

| Command | Description |
|---------|-------------|
| `npm run dev` | Start API with reload |
| `npm run build` | Compile to `dist/` |
| `npm run migrate:deploy` | Apply migrations |
| `npm run seed` | Seed demo users + settings |
| `npm test` | Run tests |

## License

Proprietary — Chebb K-Estates
