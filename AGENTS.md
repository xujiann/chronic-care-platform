# Repository collaboration boundary

This repository uses one integration line:

- integration and release branch: `main`
- process baseline: `baseline/governance-20260804-cutover-package-control-v1`
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
- Run the narrow test set while developing and `npm run test:all` before integration.
- Run `npm run routes:check`, `npm run architecture:test`, `npm run process:test`, and `npm run platform:iterations:test` for central changes.
- Do not weaken checks to make a merge pass. Any temporary branch-protection exception must be recorded and restored immediately after the authorized merge.

The detailed Chinese workflow is in
`docs/路由模块化与并行开发边界-2026-08-03.md`.
