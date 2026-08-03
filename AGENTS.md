# Repository collaboration boundary

This repository uses one integration line:

- integration and release branch: `main`
- process baseline: `baseline/governance-20260803-four-class-closure-v1`
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

The detailed Chinese workflow is in
`docs/路由模块化与并行开发边界-2026-08-03.md`.
