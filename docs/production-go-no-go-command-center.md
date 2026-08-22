# Production Global Go/No-Go Command Center

## Purpose

The command center aggregates the final P0 production evidence into one auditable decision path. It does not create or certify evidence and it does not execute deployment.

## Required gates

1. All ten platform P0 blocker records are `site-accepted` with business, information, operations and security signers.
2. P0-07 has two independent security release opinions bound to the current evidence fingerprint.
3. `launch-smoke-report.json` passes all checks and includes at least two live HTTP checks against a non-local HTTPS production address; localhost and static-only smoke cannot qualify.
4. `production-cutover-checklist.json` uses the `production` profile and passes 10/10 unique checks.
5. `CUTOVER_DR_REHEARSAL_SIGNOFF` is set only after the signed backup, restore, failover and rollback rehearsal is archived.
6. A trusted preflight GO decision receipt is synchronously verified through an explicitly injected verifier. It must be current, single-use/replay-protected and exactly bind the current `releaseId`, immutable `sha256:` artifact digest and evidence fingerprint.

After all gates pass, four different accounts must approve the business, information, operations and security roles. Each approval stores the controlled responsibility, minimized evidence reference and prerequisite fingerprint. An approval cannot be overwritten, and only its original signer may revoke it. Any evidence change invalidates the old approval automatically.

This evidence drift remains visible as a stale approval in the command center. It no longer counts toward the four-party gate and must be revoked by the original signer before a current-evidence approval is recorded.

The workbench also exposes evidence drift: when a site acceptance, security opinion, smoke report, cutover checklist, or DR signoff changes after an approval, that approval is shown as stale and is removed from the valid approval count until the signer re-approves the current fingerprint.

## Decision rules

- `GO` requires all current prerequisites, four valid independent approvals, an independent command decision owner, a change ticket, cutover window, rollback owner and the exact confirmation `APPROVE PRODUCTION GO LIVE`.
- `NO-GO` requires a change ticket and reason, and can be recorded at any time so the command team can stop a release without inventing unavailable cutover details.
- A historical GO is effective only while its evidence fingerprint and all approvals still match the current gate.
- Local JSON, an environment boolean, ordinary `evidenceRef`, a boolean verifier result or a serialized/synthetic verified object can never substitute for the trusted receipt. Missing, asynchronous, exceptional, expired, future-dated, replaying or binding-drifted verification remains `NO-GO` with a stable redacted code.

## Production boundary

The workbench does not replace the change advisory board, hospital-side authorization, security assessment, disaster-recovery certification or government approval. The unique production authorization authority, receipt issuer, trust root and durable anti-replay store still require an Accepted ADR and site validation. This repository-side invariant only prevents a false-positive GO; it does not set environment signoffs, upload signed files, run migrations, switch traffic or execute rollback.

## Verification

```powershell
node --test test/production-go-no-go.test.js test/production-preflight-decision-receipt.test.js
npm.cmd run production:go-no-go-readiness
npm.cmd run deploy:check
```
