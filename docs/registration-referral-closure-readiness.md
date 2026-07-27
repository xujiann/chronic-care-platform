# Registration, Referral and Family Doctor Closure Readiness

## Scope

The readiness layer composes the pure domain normalizers into one read-only operational report. It covers appointment registrations, referral teleconsultations, family doctor applications and contracts, and chronic follow-ups without mutating database records.

It produces four distinct conclusions:

- `functionalOk`: normalization, responsibility assignment, notification classification and reference validation executed correctly.
- `dataReady`: no P0 cross-record consistency blockers remain.
- `ok`: both functional validation and data readiness pass.
- `productionReady`: always false until live integrations and onsite signoff exist.

## Report sections

### Unified cases

Every source record becomes a unified case with its phase, current owner, next action, notification evidence, exception state and upstream/downstream references.

### Responsibility queue

Every non-terminal case must expose exactly one current `responsibleRole` and one `nextAction`. The queue also classifies due dates as `overdue`, `due-within-24h`, `scheduled` or `not-set`.

### Exception queue

Registration payment, refund and disruption exceptions and overdue/high-risk follow-ups are surfaced separately. Cross-record P0 issues remain in the consistency blocker list because they cannot be safely assigned to a normal business transition.

### Notification and receipt evidence

The report counts `sent-unconfirmed`, `delivered-unacknowledged`, partial and complete acknowledgement separately. Empty receipts never close a cross-institution hand-off.

### Consistency blockers

The current `data/db.json` chain has been repaired and passes local reference validation. The report still retains broken-chain regression coverage and does not mutate data while running. The existing shared `server.js` referral seed already carries the same collaboration-order values and should remain parity-checked by T00.

### Repair rehearsal

The report includes a guarded, in-memory repair rehearsal. The repaired current data needs no replacement; the retained broken fixture produces two safe replacements, no manual-review candidates and zero residual P0 issues after rehearsal. Every replacement carries its old value, authoritative referral value, resident/referral preconditions and impacted source list. No file is written by the rehearsal.

## Command line

The script can write JSON and Markdown evidence:

```powershell
node scripts/registration-referral-closure-readiness.js --allow-failure
```

Optional flags:

- `--output=<path>`
- `--markdown=<path>`
- `--as-of=<ISO timestamp>`
- `--allow-failure`

Without `--allow-failure`, data or functional blockers produce a non-zero exit code. Package script, release artifact manifest, deploy checks and public API wiring are intentionally not added in this branch and remain T00 integration work.

## Acceptance boundary

Local readiness passes only when all four domains are represented, all open cases have a responsibility and next action, notification states are explicit, and P0 reference issues are zero. Even then, `productionReady` remains false until live HIS, payment, insurance, referral and messaging callbacks plus onsite responsibility, cutover and rollback evidence are complete.
