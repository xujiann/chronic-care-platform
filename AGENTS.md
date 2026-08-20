# Repository collaboration boundary

This repository uses one integration line:

- integration and release branch: `main`
- process baseline: `baseline/governance-20260817-enhancement-v1`
- ownership manifest: `config/process-workstreams.json`

Before changing a protected runtime file, identify the process from the current
`process/tNN-<topic>-YYYYMMDD` branch and follow its ownership entry.

## Mandatory rules

1. T00 exclusively owns `server.js`, the router, route order, runtime-source
   composition, workflow/ownership configuration, CI, and deployment packaging.
2. T01-T09 may edit only their owned route modules among protected files.
3. Domain code, tests, and documentation may be changed by the responsible
   process, but cross-domain protocol or route-order changes must be handed to T00.
4. Do not add domain routes back to `server.js`.
5. Run `npm run process:verify` before handoff. Run route and domain tests in
   addition to the ownership check.
6. Do not remove or relax tests to resolve integration conflicts.
7. Production Go/No-Go remains dependent on real environment and signed site
   evidence; repository changes cannot manufacture that evidence.
8. This is currently a single-maintainer repository. The protected main branch
   requires pull requests and strict CI, but does not require an impossible
   self-approval. Re-enable one approval and CODEOWNER review when a second
   eligible reviewer is added.
9. `main` is the unique protected integration, release, and default branch.
   Feature and process branches are short-lived and target `main`; release
   promotion uses immutable tags and environment approvals instead of a
   long-lived integration branch.
10. Create process worktrees through `npm run process:plan` / `npm run process:create`
    and use branch names in the form `process/tNN-<topic>-YYYYMMDD`.

## Production safety

- Default to `NO-GO`, `productionReady: false` and `productionPrimary: false`.
- Environment flags and automated tests cannot prove external migration, joint testing, security assessment, monitoring delivery, disaster recovery, site acceptance or approval.
- Store only controlled evidence references and SHA-256 digests. Never commit credentials, tokens, private keys, patient data or raw provider messages.
- Production worker activation requires verified schemas, idempotent reconciliation, current external evidence, independent approvals and an explicit runtime activation.
- Do not perform request-path dual writes. Relay committed local outbox events to idempotent sinks and persist a recoverable checkpoint.

## Verification

- Add deterministic unit tests for every new state transition, failure path and evidence gate.
- Run the narrow test set while developing. Before integration run `npm run build`,
  `npm run lint`, `npm run typecheck`, `npm run test:unit`,
  `npm run test:integration`, `npm run test:smoke`, and the unchanged legacy
  full-discovery guard `npm run test:all`.
- Run `npm run routes:check`, `npm run architecture:test`, `npm run process:test`, and `npm run platform:iterations:test` for central changes.
- Do not weaken checks to make a merge pass. Any temporary branch-protection exception must be recorded and restored immediately after the authorized merge.

The detailed Chinese workflow is in
`docs/路由模块化与并行开发边界-2026-08-03.md`.

## Project engineering rules

1. Preserve existing behavior unless the approved task changes it.
2. Do not rewrite working modules without approval; prefer incremental change.
3. Before changing a module, understand callers, callees, data, authorization,
   configuration, tests and process ownership.
4. Search the repository before creating a utility, component, service, type,
   API, collection or core concept. Do not duplicate existing functionality.
5. Public interfaces remain backward compatible unless explicitly approved.
6. Schema changes require versioned migrations, verification and recovery.
7. New features require tests; bug fixes should add regression tests when practical.
8. Do not delete or weaken tests to make CI pass.
9. New dependencies require justification, security/license review and rollback.
10. Architecture changes require an ADR. Proposed ADRs do not authorize work.
11. Run the checks required by the change risk before declaring completion.
12. Keep every change scoped to the approved task.

### Protected artifacts and boundaries

- Do not directly edit `data/db.json`, SQLite/WAL/SHM files, generated reports,
  PDFs, release packages or archives.
- The main application, embedded presentation sites, external showcase, emergency
  artifacts and video projects have separate source/dependency/release boundaries.
- `emergency-release` is a derived artifact, never a second editable source tree.
- Never commit credentials, real patient data, raw provider payloads or production
  secrets. Demo identities and static data must be synthetic and clearly bounded.
- When the worktree already contains user changes, do not stash, reset, clean,
  overwrite, move or delete them. Create a safe worktree or request direction.
- API, authentication, authorization, database, audit or deployment changes must
  update their contracts, maps, tests and operational documentation.

### Boy Scout Rule

When modifying legacy code: do not perform unrelated large refactors; fix small
nearby issues only when safe; improve naming where directly relevant; add missing
tests; reduce duplication only within the approved scope; move touched code a
small step toward `MODULE_INTERFACE_STANDARD.md`. This rule never expands task
scope or authorizes public-interface, schema, security, dependency or topology
changes.

## Daily development loop

At the start of each development day:

1. Inspect branch, worktree and user changes. Pull only when safe.
2. Inspect latest default-branch/current-PR CI and yesterday's PR/review state.
3. Read `ROADMAP.md`, `ARCHITECTURE.md`, this file,
   `ENGINEERING_GOVERNANCE.md`, the six AS-IS maps and relevant ADRs.
4. Search existing implementations and produce a PLAN with goal, scope,
   non-goals, owner, options, risk, migration/rollback, tests and completion.
5. Do not code before the user or designated owner approves the direction.

```text
PLAN
  -> direction approval
  -> implementation
  -> tests
  -> /review
  -> PR
  -> merge
```

Every failed gate returns to the nearest safe stage. A previous day's approval or
green CI does not replace today's branch, dependency and evidence check.

Before changing code or configuration, read all six maps:
`CURRENT_ARCHITECTURE.md`, `MODULE_MAP.md`, `DATA_MODEL.md`, `API_MAP.md`,
`DEPENDENCY_MAP.md`, and `TECH_DEBT.md`. Database work also requires
`DATABASE_SCHEMA.md`, `DATABASE_DEVELOPMENT_STANDARD.md` and
`CORE_DATA_DEFINITIONS.md`. Module work requires `MODULE_CLASSIFICATION.md`,
`MODULE_INTERFACE_STANDARD.md` and `REFACTORING_SAFETY_NET.md`.
