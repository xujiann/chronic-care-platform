# Appointment Callback Integration and Reconciliation Center

## Purpose

The center moves the appointment journey from local role actions to a production-shaped callback contract. It reuses `integrationContracts`, `integrationGatewayEvents`, `registrationOrders`, `taskMessages`, `dataAccessLogs` and `securityEvents`.

The contract ID is `appointment-order-v1`. Every inbound callback must include:

- `externalId`: upstream callback identifier and contract idempotency field.
- `idempotencyKey`: request replay guard stored by the integration gateway.
- `residentId`, `orderNo`, `slotId`: resident, platform/HIS order and source-slot linkage.
- `eventType`, `orderStatus`, `occurredAt`: callback type, upstream status and source occurrence time.
- `x-integration-signature`: HMAC-SHA256 signature over the canonical request payload.

## Callback state machine

| Event | Allowed source role | Landing rule |
|---|---|---|
| `payment-succeeded` | institution / commission | Open order becomes paid and stores the signed receipt reference. |
| `payment-failed` | institution / commission | Open order stores failure code and remains blocked from confirmation. |
| `his-confirmed` | institution / commission | Requires payment evidence and stores the HIS callback reference. |
| `insurance-confirmed` | insurance / commission | Stores insurance confirmation and coverage evidence. |
| `checked-in` | institution / commission | Requires payment and HIS confirmation. |
| `completed` | institution / commission | Requires check-in and closes the visit. |
| `refund-completed` | institution / commission | Requires a cancelled refund-pending order. |
| `refund-failed` | institution / commission | Keeps the refund exception open for retry and reconciliation. |

Callbacks that fail order matching, role scope or state ordering are retained as dead letters. Commission users can use the cross-domain retry and dead-letter routes. The owning institution can retry only its own appointment dead letters through the registration remediation route, with a required handling note and a three-attempt limit. The original idempotency key and audit record remain unchanged.

## APIs

- `POST /api/integration/events`: verifies signature and required fields, rejects idempotent duplicates, lands valid appointment callbacks and records unmatched callbacks as dead letters.
- `GET /api/registrations/integration-center`: returns role-scoped source, callback, signature, reconciliation and exception metrics.
- `POST /api/registrations/integration-events/:id/retry`: lets the owning institution or commission retry an appointment dead letter with a required handling note, institution-scope guard and three-attempt limit.
- `POST /api/registrations/integration-events/:id/reconciliation`: assigns, resolves or reopens a role-scoped manual reconciliation case after automatic retries are exhausted.
- `GET /api/integration/monitor`: provides the cross-domain gateway monitor.
- `POST /api/integration/events/:id/retry`: records a retry attempt.
- `POST /api/integration/events/:id/dead-letter`: records a dead-letter decision and reason.

## Reconciliation evidence

Each landed callback records `orderId`, `orderNo`, `eventType`, `hospitalCode`, `landingStatus`, `reconciliationStatus`, `signatureVerified` and `productionEvidence=false`. A retry additionally records `retryCount`, `lastRetriedAt`, `lastRetryNote`, `lastRetryBy` and `lastRetryResult`. A manual case records its case ID, status, priority, owner, due time, original reason, evidence reference, resolution and action history. The linked registration order receives an `integration-*` audit entry with external ID and idempotency key.

## Institution remediation workflow

The institution workbench shows the dead-letter reason, current retry count and a handling-note input. A retry is available only while the event belongs to the signed-in institution and has fewer than three attempts. Successful retries refresh the order journey and reconciliation metrics immediately. Failed retries remain in the dead-letter queue.

After three failed retries, the owning institution can create a manual case with `P0/P1/P2` priority, owner, due date and assignment note. Resolution requires one of `manual-compensation`, `duplicate-confirmed` or `upstream-cancelled`, plus a receipt or evidence reference. Resolved cases no longer count as open dead letters, but they remain distinguishable from callbacks that actually landed. Reopening restores the manual-review state and the original dead-letter reason. Manual actions never mutate the linked appointment order and never set `productionEvidence=true`.

## Production boundary

This implementation validates contract shape, HMAC verification, idempotency, role scope, order matching, state ordering, retry, dead-letter and reconciliation behavior. It does not make a local callback production evidence.

Production go-live remains blocked until live HIS/payment/insurance endpoints, network allowlists, non-placeholder secrets, machine identities, certificate rotation, signed field dictionaries, full success/failure joint testing, rollback rehearsal and multi-party cutover approval are complete.
