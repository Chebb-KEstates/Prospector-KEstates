# Backend tests

These run against a **real MySQL**, not a mock. That's deliberate: nearly every
bug worth catching here is dialect-level — generated columns, the `unit_key`
upsert, `FOR UPDATE` locking, JSON round-tripping, `NOT NULL` catching a wipe.
A mock would have agreed with the bugs.

```bash
docker start prospector-mysql     # once per boot
npm run migrate
npm test
```

## Run them serially

`npm test` passes `--test-concurrency=1` and you must keep it.

The test files share one database, and several of them wipe tables to get a
known baseline. Run in parallel (the runner's default) and one file's
`DELETE FROM properties` lands in the middle of another file's test — which
shows up as `'That unit no longer exists.'` on tests that pass fine on their own.
The failure looks like a code bug and isn't one.

If you want real parallelism later, give each file its own database rather than
its own `org_id` — `kOrgId` is a shared constant in the domain layer.

## What's covered

| File | Guards |
|---|---|
| `propertyRepo.test.ts` | dedupe by `unit_key`, `owner_key` parity with the shared `ownerKeyOf()`, generated `callable`, filter/sort/paginate semantics, facets over the whole scope |
| `importService.test.ts` | staging, server-side dry run, the dataset-id regression, re-import updating in place, staged rows dropped at commit, cross-user access |
| `revealService.test.ts` | the single door a real phone leaves by: cap enforcement, manager exemption, per-local-day reset, and that a *blocked* reveal is still audited |

Three of these are regression tests for bugs that existed in the reference
implementation; one (`a blocked reveal is still audited`) is for a bug
introduced during the port and caught by end-to-end testing. Don't delete them
to make a refactor pass.
