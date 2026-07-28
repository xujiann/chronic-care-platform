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

## Independent institution selection

The four specialties are installable modules rather than a mandatory bundle. Each module owns its business page, API route, external-system adapters, data boundary and acceptance scenarios. A module may use shared platform capabilities such as institution identity, authorization, signed interfaces and append-only audit evidence, but it has no runtime dependency on another specialty module.

Generate a standalone or institution-specific pack with:

```powershell
node emergency-specialty-cutover.js --tracks clinical-blood --output-prefix t10-clinical-blood
node emergency-specialty-cutover.js --tracks regional-imaging-cloud,physical-examination --institution-id institution-a --output-prefix institution-a-specialties
```

The default command still generates the four-module T10 integration pack. `moduleCatalog` records enabled and disabled module IDs, deployment units, external systems, data boundaries, shared platform capabilities and peer-module dependencies. The peer dependency count must remain zero so an institution can adopt any one module without installing the other three.

`institutionDeploymentManifest` turns that selection into a fail-closed deployment contract. It records the institution ID, enabled and disabled modules, page/API allowlists, per-module data namespaces, external systems and independent rollback units. Disabled modules must remain unreachable and receive no production traffic. Enabling a module does not waive site evidence or formal Go/No-Go approval; production traffic remains `blocked-until-site-evidence-signed`.

`institutionDeploymentGate` executes nine contract checks during pack generation and runtime smoke: deny-by-default activation, exact enabled/disabled sets, page and API allowlists, unique data namespaces, unique rollback units, zero peer-module dependencies and the production-traffic boundary. Any failed check emits a hard-stop ID and blocks the deployment contract before an institution-specific package can enter controlled rehearsal.

`specialtyCompatibilityMatrix` executes the deployment contract against all 15 non-empty combinations of the four specialties. Every combination must retain exact page/API allowlists, unique data namespaces, independent rollback units and zero peer-specialty dependencies.

Build a deliverable institution package with:

```powershell
node scripts\t10-institution-package.js --institution-id=hospital-a --tracks=clinical-blood,physical-examination
```

The package contains `deployment-package.json`, `deployment-package.md`, `activation.env.example`, `rollback-plan.md` and `artifact-index.json`. The SHA-256 index covers the four payload artifacts. Package generation immediately re-reads the directory and verifies every indexed digest and byte count, the deployment-package digest, the deployment gate, all 15 compatibility combinations and the fail-closed production boundary. The rollback plan removes only the selected module's deployment unit, page and API from service while preserving data and evidence; it must not disable or mutate another specialty.

## Institution operations lifecycle

`t10-institution-operations.js` completes the code-side institution lifecycle:

- immutable semantic configuration versions with draft, review, approval, activation, deactivation, rollback and supersede transitions;
- four-eyes approval and append-only digest-chained configuration audit;
- Ed25519 package signatures bound to an authorized signer, institution, selected modules, package integrity, validity window, trusted public-key fingerprint and anti-replay nonce;
- evidence imports require unique evidence IDs plus ordered submit/review timestamps, original references, SHA-256 digests and four-eyes separation;
- site-evidence import bound to the verified package digest, original evidence references, SHA-256 digests, real interface version and independent submitter/reviewer identities;
- controlled scenario execution with hard-stop patient-safety, scope, idempotency, audit and evidence replay checks;
- T+1 signal evaluation that returns `stay-no-go`, `repeat-batch-1` or `open-watch-only-batch-2`;
- package upgrade diff and one-module rollback verification that preserve peer pages, APIs, data namespaces and evidence.

Generate the institution operations templates with:

```powershell
node scripts\t10-institution-operations.js --institution-id=hospital-a --tracks=emergency-life-chain,clinical-blood
```

The output includes configuration, evidence import, rehearsal result, observation, upgrade/rollback and T00 integration templates plus a SHA-256 artifact index. Templates intentionally contain placeholders and `pending`/`not-run` states; they cannot be counted as real site evidence.

## T00 integration contract

The generated `t00-integration-contract.json` keeps ownership explicit. T00 owns `server.js`, `portal.css`, `package.json`, `README.md` and the public release summary. T10 requests read-only exposure of the cutover pack, institution package and verification result. T00 must not infer site acceptance or production Go-Live from code readiness.

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

## Observation signal board

`observationSignalBoard` defines the T+1 watch signals that the command center must review before any expansion:

- patient-safety continuity: missed dispatch, handover, notification or unreachable manual downgrade path;
- signed interface and idempotency: unexplained interface failures, duplicate mutation, retry/dead-letter evidence;
- data quality, scope and privacy: over-scoped resident or institution visibility and required handover fields;
- evidence replay and audit completeness: append-only audit events and evidence packet digest replay.

The board returns three explicit outcomes: stay No-Go, repeat batch-1, or open watch-only batch-2. Watch-only expansion requires all lanes to be green and the T+1 observation memo to be accepted.

## Runtime smoke plan

`runtimeSmokePlan` is the last code-side gate before controlled rehearsal. It covers:

- cutover artifact generation (`node emergency-specialty-cutover.js`);
- static preview and specialty route rendering;
- server API and authorization contracts, including `/api/t10-specialty/cutover-pack`;
- release report and deployment gates;
- T+1 observation artifacts.

The plan status is `ready-for-runtime-smoke` and the launch mode remains `controlled-rehearsal-only`. A green runtime smoke run means the system is ready for controlled rehearsal, not that formal production Go-Live evidence has been waived. Any failed automated smoke suite, missing observation artifact, failed server API smoke or failed release/deploy gate blocks launch.

The executable smoke runner is `scripts/t10-runtime-smoke.js`. It writes:

- `release/t10-runtime-smoke-report.json`
- `release/t10-runtime-smoke-report.md`

Run it after generating the cutover pack:

```powershell
node scripts\t10-runtime-smoke.js
```

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
