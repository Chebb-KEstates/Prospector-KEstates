# prospector-React — Port Progress

Rewrite of the Flutter Prospector app (`hcbdevs-creator/Prospector`, 15,860 lines) into React,
matching the colleague's CRA + TypeScript + Context conventions. Built by transforming his scaffold
(faithful domain/logic layers) up to full UI/UX parity with the Flutter reference.

Reference Flutter source: `/Users/hcbmacbook/Desktop/Vibecoding/Prospector/prospector/lib/`
Parity spec: `Prospector/prospector/docs/React Parity Checklist.md`

## Build order & status
- [x] 0. Scaffold from colleague's CRA+TS project (git-stripped), assess domain/logic completeness
- [ ] 1. Theme foundation — full Champagne Noir palette + global CSS (light/dark/system)
- [ ] 2. Dash widget kit — HeroSlab, DashCard, StatTile, SegmentBar, MiniBarChart, ProgressLine, DashColumns, SlabAction
- [ ] 3. Watermark — identity-carrying tiled grid (name+email)
- [ ] 4. PropertyTable — 12 cols, Columns dialog (show/hide + drag-reorder), density, persistence, master-detail, teaser/hideOwner
- [ ] 5. Broker shell — Home/Today/Pool/Portfolio nav; embedded dialer + Resume; drop separate Leads/Active Call
- [ ] 6. Broker Today — owners|buyers switch + quick filter chips
- [ ] 7. Broker Home — dash-based (pipeline, me-vs-team, due-next, pool snapshot, Coach's corner)
- [ ] 8. Dialer — rich CallFlow card (select-not-advance, Save&next, reveal, flags, history) + coverflow session
- [ ] 9. Manager Home — mission control (composition, momentum, alerts, outcomes, coverage, audit feed, broker board)
- [ ] 10. Control — Import&Files / Users / Audit / Settings sub-tabs (permission-gated)
- [ ] 11. Assignments — fold Requests in (Pool|Assigned|Requests + pending badge)
- [ ] 12. Users — activity summary + soft-delete (deactivate, keep history)
- [ ] 13. Import & Files manager section + template download
- [ ] 14. Seed clearly-fake demo data (so screens aren't all-zeros)
- [ ] 15. Build clean (tsc + react-scripts build), fix errors, smoke test in browser
- [ ] 16. README + docs, git init, first commit

## Notes
- No real owner data ever enters this project. Seed data is synthetic.
- Matching colleague's file naming (PascalCase .tsx components, VaultContext/AuthContext/ThemeContext).
