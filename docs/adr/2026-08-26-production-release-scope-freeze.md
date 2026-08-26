# ADR: Freeze the first production release scope as a machine contract

- Status: Accepted
- Date: 2026-08-26
- Owner: T00 platform governance
- Decision contract: `production-release-scope.v1`

## Problem

The repository has an eight-application priority portfolio, a production API catalog, worker contracts, deployment packaging, smoke tests and strict Go/No-Go checks, but no single machine-readable contract says exactly which applications, pages, APIs, data references, workers, external dependencies and evidence belong to the first production release. A document-only list can drift independently from packaging and release checks.

## Options

1. Keep the scope in operational prose and reconcile it manually before each release.
2. Copy every application, API and data definition into a new independent registry.
3. Select the first portfolio from existing authorities, freeze every derived inventory by count and SHA-256 digest, and bind the resulting fingerprint to package verification, smoke and strict preflight.

## Advantages

Option 3 makes scope drift fail closed, preserves one authority for each underlying fact, gives deployment and Go/No-Go one stable fingerprint, and exposes repository review debt without fabricating production evidence.

## Disadvantages

The release-scope verifier depends on several governance authorities and must be updated deliberately when an accepted scope change lands. A valid frozen contract still reports production NO-GO; it cannot replace site verification or external approvals.

## Migration cost

Low. The change adds one metadata contract, one read-only verifier, tests and release-tool bindings. It does not alter routes, database schema, business APIs, stored data or worker activation.

## Risk

The principal risk is treating a valid scope fingerprint as production approval. The contract therefore fixes `productionReady` to `false`, requires external evidence, keeps all scoped API catalog entries NO-GO, and rejects forged readiness or a mismatched deployment fingerprint.

## Recommendation

Adopt option 3. The accepted first scope is `priority-eight-applications-v1`: eight priority applications plus the platform login and base health/authentication entrypoints. The source-derived verifier is CI/build-time only; the deployable artifact carries the frozen config and the build-verified fingerprint, and does not claim the repository-dependent CLI can run at the site. Any membership change requires an intentional contract update, regenerated inventory digests, tests, documentation and a new or superseding ADR. Passing this contract means only that repository scope is internally consistent; production authorization continues to come exclusively from strict preflight with release-bound external evidence.
