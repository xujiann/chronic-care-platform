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
9. When a schedule is full, the resident can join its FIFO waitlist and choose an SMS, in-app or phone notification preference.
10. A cancellation or accepted reschedule releases the original slot and automatically offers it to the first waiting resident for 30 minutes.
11. Acceptance creates a registration order from the held slot; decline or timeout releases the hold and automatically promotes the next resident.

## Roles and actions

| Role | Local action | Production integration |
|---|---|---|
| Resident | `pay-demo`, `check-in-demo`, cancel, disruption `accept` or `cancel`, waitlist join/withdraw/accept/decline | Certified payment page, signed receipt, QR check-in, resident-acceptance and waitlist delivery receipt |
| Institution | `confirm-his-demo`, `check-in-demo`, `complete-demo`, `refund-demo`, disruption `notify` or `withdraw`, waitlist `promote` or `expire` | HIS slot lock, schedule-change event, waitlist hold, queue, completion and refund callback |
| Insurance | `confirm-insurance-demo` | Medical-insurance e-voucher settlement and reconciliation |
| Commission | Supervision and rehearsal actions | Production monitoring and multi-party acceptance |

## APIs

- `GET /api/registrations/dashboard` returns scoped schedules, orders, journey metrics and allowed actions.
- `POST /api/registrations/orders` creates an appointment and locks a schedule.
- `POST /api/registrations/orders/:id/actions` records payment, HIS confirmation, insurance confirmation, check-in, completion or refund evidence.
- `POST /api/registrations/orders/:id/disruption` records a schedule-change notice, resident acceptance, resident cancellation or institution withdrawal.
- `POST /api/registrations/orders/:id/cancel` releases the slot and starts refund handling when required.
- `POST /api/registrations/waitlist` joins a full schedule waitlist.
- `POST /api/registrations/waitlist/:id/actions` promotes, accepts, declines, withdraws or expires a waitlist entry.

Each action writes `registration-journey-action` to the security audit chain and appends a resident/institution message.

## resident-acceptance: schedule disruption and rescheduling

The institution can send a `doctor-unavailable`, `schedule-adjustment` or `clinic-suspended` notice only for an open appointment that has not checked in. The replacement schedule must be available and belong to the same hospital and department. The notice stores the original appointment snapshot, proposed slot, reason, acknowledgement deadline, actor and notification receipts while keeping the original slot reserved.

When the resident accepts, the service rechecks replacement availability, releases the original schedule inventory, reserves the replacement inventory, resets HIS confirmation and records any fee difference as `supplement-pending`, `partial-refund-pending` or `not-required`. When the resident declines, the order uses the existing cancellation and refund workflow. A withdrawn notice leaves the original appointment unchanged. Every branch remains `productionEvidence=false` and retains its own audit history.

## Full-schedule waitlist

Waitlist entries are grouped by schedule and ranked by `joinedAt` using FIFO. Joining is allowed only when the schedule has no remaining slots, and a resident can have only one active entry for the same schedule. Each entry records the resident, schedule snapshot, notification preference, queue position and audit history.

When cancellation or rescheduling releases inventory, `promoteNextRegistrationWaitlist` reserves the slot for the first waiting resident, records a 30-minute `offer-pending` window and sends in-app plus SMS delivery records. The resident can accept and create a normal registration order, or decline. Institutions can expire overdue offers. Decline and timeout both release the local hold and immediately try the next FIFO entry. Manual promotion remains available when capacity is restored by a live HIS callback rather than a platform-side cancellation.

## Production boundary

All local records remain `productionReady=false`. Demo payment, refund, rescheduling and waitlist hold receipts do not represent a real financial transaction or production HIS slot transfer. Production go-live requires live HIS callbacks, certified slot holds, payment and refund services, insurance settlement reconciliation, resident-acceptance delivery receipts, timeout compensation, onsite registration policy review and signed acceptance evidence.
