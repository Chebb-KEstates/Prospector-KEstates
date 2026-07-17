# End-to-end smoke test

Drives the real app in a real browser against the real API and the real
database. It exists because the interesting failures in this migration are the
ones no unit test sees: a masked number that isn't actually masked, a broker who
can page past their own data, a session that doesn't survive a refresh.

```bash
docker start prospector-mysql
cd server && npm run migrate && npm run seed && npm run dev   # :4000
npm start                                                     # :3000
npx playwright install chromium                               # once
npm run e2e
```

`APP` at the top of `smoke.mjs` sets the frontend origin. If you run the dev
server on another port, change it there **and** add that origin to
`CORS_ORIGIN` in `server/.env` — credentialed CORS cannot use a wildcard, so an
unlisted origin fails every request.

## Reset between runs

```bash
cd server && npx tsx src/db/resetDemoPasswords.ts
```

The suite exercises the forced-password-change flow, which **actually changes
the password** — the data is real now. Without a reset, the second run can't
sign in. That statefulness is the migration working, not a bug; the reset script
just gives the suite a deterministic starting point. It refuses to run with
`NODE_ENV=production`.

## What it asserts

Beyond "the pages load":

- The bundled demo password and one-click logins are **gone** from the login screen.
- A wrong password is rejected.
- `mustChangePassword` **blocks the app**, rather than merely suggesting a change.
- **No real phone number appears anywhere** on a list surface — only the mask.
- The owner table paginates against the server (2 pages of 98 at 50/page).
- Search narrows via the server, by row count — not by scanning body text, which
  would match the community `<select>`'s own `<option>` labels.
- A session survives a reload, and the vault is there for a **fresh incognito
  context** — the thing IndexedDB could never do.
- A broker sees only their own units and cannot see the full vault.

## Deliberate noise it ignores

- `ERR_ABORTED` requests: `usePropertyPage` cancels a superseded query on
  purpose, so a stale page-1 response can't land after page-2.
- One `401 POST /api/auth/login`: that's the wrong-password step asserting
  rejection works.

Both are filtered in `smoke.mjs`. Don't "fix" them by removing the filters —
you'd be hiding the features they represent.
