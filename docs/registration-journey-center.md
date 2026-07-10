# Appointment Registration Journey Center

## Business flow

The journey reuses `registrationSchedules`, `registrationOrders`, `taskMessages`, `dataAccessLogs` and `securityEvents`.

1. The resident selects a hospital HIS or internet-hospital schedule and reserves the slot.
2. The resident records local payment evidence or uses a waived-payment schedule.
3. The hospital confirms the HIS appointment and queue information.
4. The medical-insurance role confirms the demo insurance precheck evidence.
5. The resident or hospital records check-in; the hospital records completion.
6. A cancelled paid order enters refund-pending and the hospital records the local refund result.

## Roles and actions

| Role | Local action | Production integration |
|---|---|---|
| Resident | `pay-demo`, `check-in-demo`, cancel | Certified payment page, signed receipt and QR check-in |
| Institution | `confirm-his-demo`, `check-in-demo`, `complete-demo`, `refund-demo` | HIS slot lock, queue, completion and refund callback |
| Insurance | `confirm-insurance-demo` | Medical-insurance e-voucher settlement and reconciliation |
| Commission | Supervision and rehearsal actions | Production monitoring and multi-party acceptance |

## APIs

- `GET /api/registrations/dashboard` returns scoped schedules, orders, journey metrics and allowed actions.
- `POST /api/registrations/orders` creates an appointment and locks a schedule.
- `POST /api/registrations/orders/:id/actions` records payment, HIS confirmation, insurance confirmation, check-in, completion or refund evidence.
- `POST /api/registrations/orders/:id/cancel` releases the slot and starts refund handling when required.

Each action writes `registration-journey-action` to the security audit chain and appends a resident/institution message.

## Production boundary

All local records remain `productionReady=false`. Demo payment and refund receipts do not represent a real financial transaction. Production go-live requires live HIS callbacks, certified payment and refund services, insurance settlement reconciliation, onsite registration policy review and signed acceptance evidence.
