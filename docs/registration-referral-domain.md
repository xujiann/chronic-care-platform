# Registration, Referral and Family Doctor Closure Domain

## Purpose

This module provides a pure, read-only normalization and validation layer over the existing appointment registration, referral teleconsultation, family doctor and chronic follow-up records. It does not replace the business-specific status fields. It adds one cross-domain envelope so responsibility hand-offs, notification receipts, exceptions and closure evidence can be evaluated consistently.

The first increment deliberately does not modify `server.js`, `package.json`, shared pages, the release manifest or database seed data.

## Unified envelope

Every normalized record exposes:

- `caseType`, `caseId`, `residentId` and the original `businessStatus`.
- `unifiedPhase` for cross-domain reporting.
- `sourceOrg`, `responsibleOrg`, `responsibleRole`, `dueAt` and `nextAction`.
- `notificationState` and `receiptState`.
- `exceptionState`, upstream and downstream references.
- `productionEvidence=false` for this local validation layer.

The unified phases are:

`requested`, `accepted`, `resource-reserved`, `payment-pending`, `payment-recorded`, `scheduled`, `service-in-progress`, `result-returned`, `primary-care-followup-pending`, `closed`, `cancelled` and `exception`.

## Closure rules

### Appointment registration

- Payment pending belongs to the resident.
- Paid but not HIS-confirmed belongs to the institution registration desk.
- HIS-confirmed but not checked in belongs to the resident.
- Checked in belongs to the receiving clinical team until completion.
- Refund pending or failed remains an exception owned by institution finance.
- A pending schedule disruption belongs to the resident until acceptance or rejection.
- Non-refund callbacks are rejected after cancellation, completion or closure.

### Referral and teleconsultation

- Requested referrals belong to the referral center or receiving institution.
- Hospital-initiated down-referrals use the same resident authorization, collaboration-order and report-continuity references as upward referrals, but hand ongoing responsibility to the target primary-care institution.
- `supplement-required` returns responsibility to the referring institution; `supplement-submitted` returns it to the receiving referral center for explicit approval or another correction round.
- Scheduled consultations remain with the receiving hospital until a signed report is returned.
- Rejected, withdrawn and cancelled referrals are terminal cancellation paths; a no-show is an exception owned by the receiving hospital until it is rescheduled or cancelled.
- Revoked resident authorization places every non-terminal linked referral in `authorization-on-hold`; the primary institution must obtain new consent, reassign or withdraw it.
- Replacement resident or guardian authorization records the permitted institutions, expiry, consent proof and minimum clinical data scopes before a held referral can resume.
- Report return is not closure. It becomes `primary-care-followup-pending` until the primary institution or family doctor accepts the report and follow-up responsibility.
- A technical delivery receipt does not substitute for business acknowledgement.

### Family doctor and chronic follow-up

- Pending applications belong to institution review.
- Approved applications require contract activation and resident notification.
- Active contracts remain with the family doctor team until the contracted services are fulfilled.
- The family doctor scheduler creates institution-scoped service, renewal and expiry tasks; a service fulfillment must link back to the task before the task can close.
- Completed follow-up remains `result-returned` until the resident acknowledges it or an auditable manual-contact result is recorded.

## Notification evidence

The module distinguishes:

`not-created -> queued -> sent-unconfirmed -> delivered-unacknowledged -> acknowledged`

Failures produce `attention-required`. Receipt statuses such as `handled`, `read`, `accepted`, `confirmed` and `acknowledged` count as business acknowledgement. `delivered` and `received` are delivery evidence only.

## Reference validation

`validateClosureReferences(data)` checks:

- Registration order to schedule hospital and department consistency.
- Teleconsultation to referral, collaboration order, resident and authorization consistency.
- Versioned clinical material identifiers, positive versions, SHA-256 digests and manifest presence.
- Family doctor contract traceability to an approved new-contract application, while allowing a pending renewal to point back to its existing active or renewal-pending contract.
- Family doctor application and contract references to configured teams, service packages and review institutions when those catalogs are present.
- Family doctor fulfillment resident, team and package consistency with its contract.
- Notification dead-letter references and resident/organization scope against the source task message.
- Family doctor service-task references and bidirectional links to their fulfillment records.
- Closure-event canonical hashes, predecessor links and unique command identifiers.

The report intentionally separates:

- `functionalOk`: the validator executed successfully.
- `dataReady`: no P0 cross-record consistency issues remain.
- `productionReady`: always false in this local increment.

The checked-in `data/db.json` records now align `rtc-001` with `cco-004` and `rtc-002` with `cco-005`, so the persisted data passes local reference validation. Regression fixtures retain the original broken chain to prove detection and repair behavior. The pending `p2fda-r2` renewal is valid because it explicitly points back to the existing `p2fdc-r2` renewal-pending contract.

## Safe repair planning

`planClosureReferenceRepairs(data)` derives a repair only when all of these conditions hold:

- The teleconsultation and its referral disagree on `collaborationOrderId`.
- The referral points to an existing collaboration order.
- That collaboration order belongs to the same resident as the teleconsultation.
- The current value and resident/referral scope can be retained as application preconditions.

`applyClosureReferenceRepairs(data, plan)` applies these replacements to a deep in-memory copy, re-runs the reference validator and never persists the result. A changed current value, changed resident scope, missing authority or resident mismatch stops application. Unsafe candidates are returned as manual reviews.

For the retained broken regression fixture, repair rehearsal proposes `rtc-001: cco-001 -> cco-004` and `rtc-002: cco-001 -> cco-005`, reducing P0 issues from three to zero in memory. `data/db.json` is repaired in this branch, and the existing `seedReferralTeleconsultations` values in shared `server.js` already match. T00 only needs to preserve and verify that parity during integration.

## Integration boundary

The module is safe to call from a future readiness script or from the shared API layer. Public route wiring, persistence, UI presentation, package scripts and release gates remain integration work for T00. Correct local state and references do not constitute live HIS, payment, insurance, message-provider or onsite acceptance evidence.
