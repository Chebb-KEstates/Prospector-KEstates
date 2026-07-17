# prospector-React — Port Progress

Rewrite of the Flutter Prospector app (`hcbdevs-creator/Prospector`, 15,860 lines) into React,
matching the colleague's CRA + TypeScript + Context conventions. Built by transforming his scaffold
(faithful domain/logic layers) up to full UI/UX parity with the Flutter reference.

Reference Flutter source: `/Users/hcbmacbook/Desktop/Vibecoding/Prospector/prospector/lib/`
Parity spec: `Prospector/prospector/docs/React Parity Checklist.md`

## Status
- [x] 0. Scaffold from colleague's CRA+TS project (domain/logic layers were already faithful — reused)
- [x] 1. Theme foundation — Champagne Noir + hero-slab tokens (his theme.css was already solid; extended)
- [x] 2. Dash widget kit — HeroSlab, SlabAction, DashCard, StatTile, SegmentBar, MiniBarChart, ProgressLine, DashColumns
- [x] 3. Watermark — identity-carrying tiled grid (name + email + date)
- [x] 4. PropertyTable — reused as the shared table (broker == vault); added Size + Last-transaction columns (12 cols)
- [x] 5. Broker shell — Home/Today/Pool/Portfolio; dialer embedded in workspace; Minimize/End + Resume when navigated away
- [x] 6. Broker Today — owners|buyers switch + quick filter chips + Start-calling
- [x] 7. Broker Home — dash-based (pipeline, you-vs-team, due-next, pool snapshot, Coach's corner)
- [x] 8. Dialer — rich CallCard (select-not-advance, Save&next, grouped reveal, flags, full history) + coverflow CallSessionView
- [x] 9. Manager Home — mission control (composition, 14-day momentum, alerts, outcomes, coverage, audit feed, broker board)
- [x] 10. Control — Import & Files / Users / Audit / Settings (permission-gated); Import & Files = both wizards + data-sets manager
- [x] 11. Assignments — Requests folded in (Pool | Assigned | Requests + pending badge)
- [x] 12. Users — activity summary + soft-delete (Deactivate/Reactivate, history kept)
- [x] 13. Import & Files manager section (data-sets table + delete)
- [x] 14. Seed clearly-fake demo data (so screens aren't all-zeros)
- [x] 15. Build clean (tsc + react-scripts build), smoke tested in browser
- [x] 16. README + title + .gitignore hardening; git history per milestone

## Verified live (localhost:3000)
- Manager mission-control home renders with seed data + identity watermark tiling director@demo.ae
- Broker Home dash; Today owners|buyers + quick filters reusing the vault PropertyTable
- Dialer embeds in workspace with Minimize; Call reveals grouped number (+971 …) + 8 owner-vocab outcomes
- Selecting an outcome does NOT auto-advance; gold "Save & next" appears — the requested Batch-8 behaviour

## QA + improvement pass (2026-07-17) — done
- Watermark: was rendering twice + uneven → single even SVG tiling of identity (faithful to Flutter)
- Dialer coverflow: rebuilt (per-tile distance transform, no overlap glitch)
- Data table: full platform — filter bar, Columns dialog (show/hide + drag-reorder), density, sort, pagination, multi-select, per-screen persistence, teaser/hideOwner
- Flexible upload: Property gained `extra`; import keeps unmapped columns; owner AND lead tables render `extra` as dynamic columns
- Earlier: single-call popup, manager full-number reveal, Team metric fixes, teaser Pool

## Finishing pass (2026-07-17) — done
- **Pool request flow**: `submitRequest` existed but nothing called it — brokers could not request data, so the manager's Requests tab could never populate. Built `PoolTab` (tick units in the teaser pool → note → submit hand-picked request; shows your pending requests). Verified end-to-end through to Approve/Deny.
- **Security fix**: AssignmentsScreen hand-rolled a table that rendered owner phones UNMASKED. Replaced with the shared `PropertyTable` (masked + full platform).
- **One table language**: extracted `common/tableLayout` (`useTableLayout` + `ColumnsDialog`); both the owner and lead tables now share ONE implementation. Lead table gained the full platform (filters, columns dialog, density, sort, pagination, persistence, dynamic extra columns).
- **Tests**: 38 passing (dispositions, masking/format, import pipeline + dedupe + flexible extra columns + owner grouping). They caught a real bug: a plain `Building` header was never auto-mapped.

## Remaining recommendation (a decision, not a task)
- Consider migrating CRA → Vite before go-live (CRA is deprecated/unmaintained since 2023). Deliberately NOT done: the stack was chosen to match the existing React project.

## Notes
- No real owner data ever enters this project. `src/data/seedDemo.ts` is synthetic.
- Matches colleague's file naming (PascalCase .tsx, VaultContext/AuthContext/ThemeContext).
