# Production database cutover center

## Scope

The production database cutover center turns the existing PostgreSQL blocker into an auditable rehearsal workflow. It defines four migration batch contracts for resident master data, clinical encounters, diagnostic reports and health statistics.

Each migration batch records source collections, target tables, business keys, validation rules, owner and rollback strategy. The center creates one sample validation per domain, calculates a SHA-256 checksum, and creates a rollback checkpoint for every rehearsal run.

## Runtime APIs

- `GET /api/production-database/cutover-center` returns migration batches, rehearsal runs, sample results, rollback checkpoints and production blockers.
- `POST /api/production-database/cutover-runs` creates a four-domain dry run against the current platform data without writing to a target database.
- `POST /api/production-database/cutover-runs/:id/actions` records commission review, rollback rehearsal evidence or a retest request.

All write actions append `securityEvents` audit evidence. Non-commission roles are denied access to both the dedicated API and the underlying cutover collections.

## Production Boundary

A successful dry run proves that the migration contract can select a resident, encounter, report and statistic sample and preserve a checksum and rollback checkpoint. It does not prove that a production database is connected.

Formal cutover remains blocked until the site provides a PostgreSQL-compatible runtime adapter and driver, `DATABASE_URL`, masked full-volume rehearsal results, capacity and failover evidence, native backup evidence, a signed migration window, and database-owner/release-manager approval.

## Acceptance

```powershell
npm.cmd run production-db:readiness
node --test test\production-db-readiness.test.js test\api.test.js test\static.test.js
npm.cmd run deploy:check
npm.cmd run release:report
```
