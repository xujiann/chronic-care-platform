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

Callbacks that fail order matching, role scope or state ordering are retained as dead letters. Commission users can use the existing retry and dead-letter routes without losing the original idempotency key or audit record.

## APIs

- `POST /api/integration/events`: verifies signature and required fields, rejects idempotent duplicates, lands valid appointment callbacks and records unmatched callbacks as dead letters.
- `GET /api/registrations/integration-center`: returns role-scoped source, callback, signature, reconciliation and exception metrics.
- `GET /api/integration/monitor`: provides the cross-domain gateway monitor.
- `POST /api/integration/events/:id/retry`: records a retry attempt.
- `POST /api/integration/events/:id/dead-letter`: records a dead-letter decision and reason.

## Reconciliation evidence

Each landed callback records `orderId`, `orderNo`, `eventType`, `hospitalCode`, `landingStatus`, `reconciliationStatus`, `signatureVerified` and `productionEvidence=false`. The linked registration order receives an `integration-*` audit entry with external ID and idempotency key.

## Production boundary

This implementation validates contract shape, HMAC verification, idempotency, role scope, order matching, state ordering, retry, dead-letter and reconciliation behavior. It does not make a local callback production evidence.

Production go-live remains blocked until live HIS/payment/insurance endpoints, network allowlists, non-placeholder secrets, machine identities, certificate rotation, signed field dictionaries, full success/failure joint testing, rollback rehearsal and multi-party cutover approval are complete.
