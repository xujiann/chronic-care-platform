# Appointment Registration Journey Center

## Business flow

The journey reuses `registrationSchedules`, `registrationOrders`, `taskMessages`, `dataAccessLogs` and `securityEvents`.

1. The resident selects a hospital HIS or internet-hospital schedule and reserves the slot.
2. The resident records local payment evidence or uses a waived-payment schedule.
3. The hospital confirms the HIS appointment and queue information.
4. The medical-insurance role confirms the demo insurance precheck evidence.
5. The resident or hospital records check-in; the hospital records completion.
6. A cancelled paid order enters refund-pending and the hospital records the local refund result.
7. If a doctor becomes unavailable or a clinic schedule changes, the institution proposes a same-hospital, same-department replacement slot and sets a resident response deadline.
8. The resident either accepts the replacement slot or declines it and enters the existing cancellation/refund path.

## Roles and actions

| Role | Local action | Production integration |
|---|---|---|
| Resident | `pay-demo`, `check-in-demo`, cancel, disruption `accept` or `cancel` | Certified payment page, signed receipt, QR check-in and resident-acceptance receipt |
| Institution | `confirm-his-demo`, `check-in-demo`, `complete-demo`, `refund-demo`, disruption `notify` or `withdraw` | HIS slot lock, schedule-change event, queue, completion and refund callback |
| Insurance | `confirm-insurance-demo` | Medical-insurance e-voucher settlement and reconciliation |
| Commission | Supervision and rehearsal actions | Production monitoring and multi-party acceptance |

## APIs

- `GET /api/registrations/dashboard` returns scoped schedules, orders, journey metrics and allowed actions.
- `POST /api/registrations/orders` creates an appointment and locks a schedule.
- `POST /api/registrations/orders/:id/actions` records payment, HIS confirmation, insurance confirmation, check-in, completion or refund evidence.
- `POST /api/registrations/orders/:id/disruption` records a schedule-change notice, resident acceptance, resident cancellation or institution withdrawal.
- `POST /api/registrations/orders/:id/cancel` releases the slot and starts refund handling when required.

Each action writes `registration-journey-action` to the security audit chain and appends a resident/institution message.

## resident-acceptance: schedule disruption and rescheduling

The institution can send a `doctor-unavailable`, `schedule-adjustment` or `clinic-suspended` notice only for an open appointment that has not checked in. The replacement schedule must be available and belong to the same hospital and department. The notice stores the original appointment snapshot, proposed slot, reason, acknowledgement deadline, actor and notification receipts while keeping the original slot reserved.

When the resident accepts, the service rechecks replacement availability, releases the original schedule inventory, reserves the replacement inventory, resets HIS confirmation and records any fee difference as `supplement-pending`, `partial-refund-pending` or `not-required`. When the resident declines, the order uses the existing cancellation and refund workflow. A withdrawn notice leaves the original appointment unchanged. Every branch remains `productionEvidence=false` and retains its own audit history.

## Production boundary

All local records remain `productionReady=false`. Demo payment, refund and rescheduling receipts do not represent a real financial transaction or production HIS slot transfer. Production go-live requires live HIS callbacks, certified payment and refund services, insurance settlement reconciliation, resident-acceptance delivery receipts, onsite registration policy review and signed acceptance evidence.
