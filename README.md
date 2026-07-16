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

### Option A — Docker (everything, one command)

```bash
cp .env .env.local   # optional: review/adjust secrets & ports
docker compose up --build
```

- App: [http://localhost:8080](http://localhost:8080)
- API: [http://localhost:4000](http://localhost:4000) (also proxied at `/api` by the web container)

The API container automatically applies migrations and seeds the demo accounts on start.

### Option B — Local development

```bash
# 1. Start MySQL (or use the compose db service)
docker compose up -d db

# 2. Backend
cd server
cp .env.example .env          # DATABASE_URL points at localhost:3307 by default
npm install
npx prisma migrate deploy
npm run seed
npm run dev                   # API on http://localhost:4000

# 3. Frontend (separate terminal, repo root)
npm install
npm start                     # http://localhost:3000, proxies /api -> :4000
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
