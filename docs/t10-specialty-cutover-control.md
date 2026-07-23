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
