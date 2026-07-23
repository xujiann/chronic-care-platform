# T10 急救、用血、影像与体检专项上线割接总控

`emergency-specialty-cutover.js` provides a read-only cutover pack for the four T10 production tracks:

- 120急救生命链
- 临床用血
- 区域影像云
- 健康体检

It does not approve production go-live by itself. It aggregates the existing specialty readiness builders, keeps code readiness separate from site evidence, and produces a single view of departments, blockers, cross-track controls and the first safe grey-release increment.

## Boundary

The service is intentionally independent from shared platform files. It does not edit `server.js`, `portal.css`, `package.json`, `README` or the public release summary. T00 can later expose it through a public route or release table without changing the specialty logic.

## Runtime source

The cutover pack reads the same readiness sources that already guard each specialty:

| Track | Builder | Primary page | Production API seam |
|---|---|---|---|
| 120急救生命链 | `scripts/emergency-readiness.js` | `emergency.html` | `/api/emergency/production-center` |
| 临床用血 | `scripts/blood-system-readiness.js` | `blood.html` | `/api/blood-system/go-live` |
| 区域影像云 | `scripts/imaging-cloud-readiness.js` | `imaging-cloud.html` | `/api/imaging-cloud/production-center` |
| 健康体检 | `scripts/physical-examination-readiness.js` | `physical-examination.html` | `/api/physical-exams` |

## State model

Each specialty is normalized into the same cutover stages:

1. `code-readiness`
2. `synthetic-acceptance`
3. `joint-test`
4. `site-evidence`
5. `go-no-go`
6. `grey-release`

Passing code checks moves a track out of `code-readiness`, but it remains blocked at `site-evidence` until real external interface receipts, four-eyes signoff and operating evidence are present.

## Cross-track controls

The cutover pack always emits four controls:

- Unified identity and role scope.
- Signed interfaces, time windows and idempotency.
- Four-eyes site evidence signoff.
- Patient-safety downgrade paths.

These controls apply to all four specialties and should be retained as go/no-go review rows even if one specialty is piloted earlier than the others.

## First acceptable increment

The current default recommendation is to pilot the 120 emergency life-chain first:

> one 120 station + one receiving hospital + one controlled gateway device, covering signed device signal, human dispatch confirmation, ambulance/hospital electronic handover and evidence export.

This increment is small enough to validate the end-to-end safety model and broad enough to exercise identity, signed interface, audit, evidence export, downgrade and clinical handover controls.

## Rehearsal and rollback

The cutover pack now includes a `rehearsalPlan` section for the selected first increment:

- `T-1 preflight`: freeze pilot scope, accounts, endpoints and rollback contacts before touching the grey-release path.
- `T0 rehearsal`: execute the selected end-to-end chain and record requests, receipts, retries, dead letters, manual review and evidence export.
- `T+1 observation`: review alerts, audit, interface receipts, data quality and manual handling before the next go/no-go decision.

Rollback is triggered when signature/idempotency checks repeatedly fail without explanation, resident or institution scope leaks, patient-safety actions are missed or misrouted, or audit/evidence records cannot support replay.

The duty roster covers business command, platform operations, security audit and site liaison. This is a rehearsal control only; it does not start a live launch or broaden the authorized production scope.

## Go/No-Go decision matrix

The cutover pack also emits a `goNoGoDecision` section. It is intentionally conservative:

- Hard stops override the score. Any patient-safety, scope/privacy, external-receipt or evidence-replay hard stop is an immediate No-Go.
- Code readiness, site evidence, dual approval, rollback readiness and T+1 observation are scored separately.
- A track cannot reach formal Go unless every required item passes and the score reaches 100/100.
- `ready-to-rehearse` means the team may run a controlled rehearsal only; it is not production authorization.

The current default decision remains `no-go-site-evidence-pending` because the four specialties have code evidence but still lack signed site receipts and observation evidence.

## Site evidence dossier

The cutover pack now emits an `evidenceDossier` section. It converts every site blocker into a reviewable evidence entry with:

- a stable evidence ID in the form `trackId:blockerId`;
- P0/P1/P2 severity and `hardStopIfMissing`;
- whether the entry is required for the first grey increment;
- required artifacts such as site signoff form, original external receipt, operator/reviewer identities, SHA-256 digest and rollback evidence;
- verification checks for dual signoff, audit-chain linkage, external receipt matching, idempotency/nonce and certificate/key custody where applicable.

The review policy keeps a strict production boundary: the submitter and reviewer must differ, evidence must be digest-addressed, and only accepted site evidence can close a site-pending blocker. Demo data cannot close production evidence.

## Controlled pilot batches

The pack also emits a `pilotBatchPlan`:

1. `batch-0-preflight`: no live traffic; verify accounts, endpoints, evidence templates, rollback contacts and owner assignment.
2. `batch-1-single-chain`: run only the selected first increment and export replayable audit, receipt, retry and manual-review evidence.
3. `batch-2-watch-only`: observe the next specialty with read-only or synthetic impact after T+1 observation is clean.

Each batch has entry criteria, exit criteria and a promotion decision. Expansion is blocked until the previous batch has no unexplained P0/P1 issue.

## Site evidence workflow

The pack adds a `siteEvidenceWorkflow` state machine so evidence closure can be rehearsed before live cutover:

1. `draft`
2. `submitted`
3. `under-review`
4. `returned`
5. `accepted`
6. `expired`

The key transitions are `submit-evidence`, `start-four-eyes-review`, `accept-evidence`, `return-for-correction`, `resubmit-evidence` and `invalidate-after-scope-change`.

`batch-1-single-chain` requires every first-increment evidence ID to be at least `submitted`; `accepted` is preferred before any real grey-release decision. P0 evidence cannot be waived. If evidence is returned, the linked blocker is reopened and the Go/No-Go scorecard item returns to `pending`. Accepted evidence expires when pilot scope, external endpoint, certificate, device, institution or interface version changes.

Every transition emits append-only `site-evidence.*` audit events with evidence ID, track ID, actor, role, from/to state, timestamp, digest and reason.

## Acceptance scenario suite

The pack now includes an `acceptanceScenarioSuite` for the first grey increment. It converts the 120 emergency life-chain pilot into executable scripts:

- normal end-to-end signal, dispatch, hospital handover and evidence export;
- duplicate signal and idempotency replay;
- invalid signature and certificate rejection;
- network outage with manual downgrade;
- evidence packet replay and Go/No-Go update.

The suite status is `ready-for-controlled-rehearsal-only`. Hard-stop scenario failure keeps the decision at No-Go. The audit replay scenario can return evidence for correction without mutating original records.

## Scenario evidence matrix

`scenarioEvidenceMatrix` links each acceptance scenario to:

- required first-increment evidence IDs;
- minimum evidence state (`submitted` or `accepted`);
- required workflow audit events;
- Go/No-Go impact;
- replay requirement and current result.

All hard-stop scenario rows must pass before the scorecard can improve. The audit replay row must prove evidence closure without changing source records. Missing workflow events keep linked evidence at `submitted` or `returned`.

## Cutover command center

The pack now emits a `cutoverCommandCenter` board that turns the evidence, batch and scenario controls into an accountable duty model:

- `window-t-1-freeze`: freezes pilot scope, endpoints, accounts, evidence owners and rollback contacts before batch-1 can start;
- `window-t0-controlled-rehearsal`: runs the hard-stop scenarios, captures interface/idempotency ledgers and records patient-safety downgrade proof;
- `window-t-plus-1-observation`: reviews alerts, audit replay, data-quality samples and manual handling before deciding No-Go, repeat batch-1 or open watch-only batch-2.

The board also lists command seats (`release-commander`, `business-commander`, `operations-duty`, `security-audit`, `site-liaison`), escalation rules and decision artifacts. Missing append-only audit evidence, unexplained interface failures or any P0 patient-safety/privacy/security event keeps the release at No-Go.

## Verification

Run the focused test directly:

```powershell
node --test test\emergency-specialty-cutover.test.js
```

Generate the read-only cutover artifacts:

```powershell
node emergency-specialty-cutover.js
```

This writes:

- `release/t10-specialty-cutover-pack.json`
- `release/t10-specialty-cutover-pack.md`

For a full T10 check, run the existing specialty tests together with this new test:

```powershell
node --test test\emergency-specialty-cutover.test.js test\emergency-device-gateway.test.js test\emergency-lifechain.test.js test\emergency-production.test.js test\blood-business-service.test.js test\blood-go-live-service.test.js test\imaging-cloud-production.test.js test\physical-examination.test.js
```
