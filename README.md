# Prospector

**Prospector** is a CRM and call-management platform built for Dubai real estate brokerages. It enables teams to manage property listings, buyer leads, call dispositions, and daily operations through a shared data vault with role-based access for managers and brokers.

## Features

- **Data Vault** — Central repository of properties, leads, call logs, and import datasets, stored locally via IndexedDB
- **Import Wizards** — Step-by-step CSV/XLSX import for property and lead data with column mapping, header detection, and review
- **Owner Grouping** — Automatically groups properties/leads by shared phone numbers into unified owner profiles
- **Call Session** — Carousel-based dialing interface with disposition logging and cooldown management
- **Disposition State Machine** — Tracks property state (cold, warm, hot, callback, sold, dead, DNC) through configurable outcomes
- **Assignment Engine** — Bulk-assign units to brokers with owner-linked automatic expansion
- **Request/Approve Workflow** — Brokers request assignments or ownership transfers; managers approve or deny
- **Daily View Caps** — Enforce per-broker daily view limits with optional override per user
- **Audit Trail** — Every action is logged with timestamp, actor, and detail
- **Cross-Tab Sync** — Changes made in one browser tab are reflected in all others via localStorage
- **Champagne Noir Theme** — Dark and light mode with a refined, professional design system

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 18 |
| Language | TypeScript |
| Routing | React Router v6 |
| Storage | IndexedDB (`idb`), `localStorage`, `sessionStorage` |
| Parsing | `xlsx` (Excel), `papaparse` (CSV) |
| Build | Create React App |

## Getting Started

```bash
npm install
npm start
```

The app will open at [http://localhost:3000](http://localhost:3000).

### Demo Accounts

| Role | Email | PIN |
|------|-------|-----|
| Manager | `manager@prospector.ae` | `1234` |
| Broker | `broker@prospector.ae` | `1234` |

### Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Start development server |
| `npm run build` | Build for production to `build/` |
| `npm test` | Run tests |

## License

Proprietary — Chebb K-Estates
