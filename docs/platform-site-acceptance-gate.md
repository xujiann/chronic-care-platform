# Platform Site Acceptance Gate

## Purpose

The platform production-blocker ledger now records a controlled site-acceptance step after remediation evidence has been submitted and reviewed. It is a traceable preparation step for production release, not an automatic production approval.

## Required sequence

Use the `record-site-acceptance` action only after evidence reaches `evidence-reviewed-site-pending`. Use `revoke-site-acceptance` when a signed record or its supporting evidence changes.

1. Assign the P0 blocker and start remediation.
2. Record minimized evidence references and submit the evidence.
3. Complete the pre-production evidence review.
4. Record one site acceptance identifier with four named signers: `business`, `information`, `operations`, and `security`.
5. Keep the blocker at `site-accepted` until the overall go/no-go process is completed. A site acceptance can be revoked and returns the blocker to remediation.

## Production boundary

`site-accepted` only records that the item has a complete site acceptance record. It does not set `productionReady` and it does not change the platform formal go-live state to ready. Even when all individual blockers are site-accepted, the platform remains `blocked-until-global-go-no-go` until the actual production environment, external interface receipts, security assessment, disaster-recovery rehearsal, and formal go/no-go approval are evidenced outside the demo repository.

## Verification

```powershell
node --test test/platform-production-audit.test.js
npm.cmd run platform:production-audit
```
