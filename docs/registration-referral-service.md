# Registration, Referral and Family Doctor Closure Service

## Scope

`registration-referral-service.js` is the API-independent command layer for the T05 workflow. It composes the existing registration journey and callback functions with new primary-care, referral continuity, notification, chronic follow-up and family doctor closure commands.

Every command requires a unique `commandId`. The service binds that key to a SHA-256 fingerprint covering the normalized action, case, resident, payload, supplied timestamp, actor identity and scope, plus the notification fallback policy when relevant. Only an exact replay is idempotent; altered requests, actors and legacy audit rows without a fingerprint fail with `idempotency key conflict`.

The service clones the supplied database, applies one authorized command, appends a non-production `registrationReferralClosureEvents` audit row, validates cross-record consistency and returns the changed copy. It never writes a file or claims production evidence.

Business terminal states are also enforced independently of `commandId`: one primary-care assessment cannot create a second referral chain, accepted continuity cannot be accepted again, completed or resident-acknowledged follow-ups cannot be rewritten, family-doctor acknowledgements are final, acknowledged notification receipts cannot regress, and notification fallback stops when the final channel exhausts its configured attempts.

## Supported commands

| Command | Primary responsibility |
|---|---|
| `advance-registration` | Reuse the existing payment, HIS confirmation, insurance, check-in, completion and refund journey actions and create a receipt-ready notification. |
| `apply-registration-callback` | Enforce strict terminal/state ordering before applying a signed appointment callback. |
| `record-primary-care-assessment` | Record grassroots first diagnosis and either create a local follow-up or mark referral as the next action. |
| `create-referral-from-primary-care` | Create a resident-consistent collaboration order, referral and optional teleconsultation from an authorized assessment. |
| `accept-referral-request` | Let the receiving institution accept a scoped referral, return triage feedback and synchronize the linked referral/collaboration order. |
| `schedule-teleconsultation` | Reserve the receiving doctor and consultation window after acceptance and notify the resident and source institution. |
| `return-referral-report` | Return a signed business report, archive it to the resident record and hand responsibility back to primary care. |
| `accept-referral-continuity` | Accept a returned report, create the primary-care/family-doctor follow-up and close the referral continuity hand-off. |
| `complete-chronic-followup` | Record the institution result and send a resident acknowledgement request. |
| `acknowledge-chronic-followup` | Record resident understanding and close follow-up evidence. |
| `acknowledge-family-doctor-fulfillment` | Bind resident acknowledgement and satisfaction to a contract fulfillment. |
| `record-notification-receipt` | Record scoped delivery, failure, read, handled or acknowledgement evidence. |
| `run-notification-fallback` | Apply bounded in-app, SMS, phone and manual-task fallback. |
| `escalate-case` | Create an idempotent responsibility escalation for a non-terminal unified case. |

## Authorization

- Commission users can operate across organizations for supervision and reconciliation.
- Institution commands that operate on institution-scoped data require `orgCode` and enforce an exact source or target institution match.
- Citizen acknowledgements require the message, fulfillment or follow-up resident to be in the actor's resident scope.
- Notification access additionally checks `targetRole` and `targetOrgCode`.
- Referral creation requires an active resident authorization and a resident-consistent target chain.

## Notification fallback

The default sequence is:

1. In-app: one attempt.
2. SMS: three attempts.
3. Phone: two attempts.
4. Manual institution task: one terminal fallback.

Each attempt records channel, status, reason, actor and time. An acknowledged message cannot be sent through fallback again.

## Persistence transaction

T00 should expose one command endpoint and persist the returned copy inside the existing database write boundary:

1. Authenticate the request with the current session and role guard.
2. Collect a JSON command and require a client-generated `commandId`.
3. Load the latest database snapshot.
4. Call `applyClosureCommand(data, command, user)`.
5. If the result is not idempotent, persist `result.data` atomically once.
6. Return the command event, business result, idempotency flag and consistency summary.
7. Append the existing security and data-access audit records around the transaction.

The service's clone-and-return behavior is intentional: it avoids partial writes when a command creates several linked records.

## T00 integration contract

Public integration remains responsible for:

- Requiring `registration-referral-service.js` from `server.js`.
- Adding `POST /api/registration-referral/commands` or the suggested per-command endpoints from `CLOSURE_COMMAND_CONTRACTS`.
- Preserving the already-correct `seedReferralTeleconsultations` parity: `rtc-001 -> cco-004`, `rtc-002 -> cco-005`.
- Synchronizing `seedTaskMessages`: both `rtc-002` messages must use resident `r4` and the down-referral report text.
- Initializing `primaryCareAssessments`, `registrationReferralClosureEvents` and `registrationReferralEscalations` as empty collections for a fresh database.
- Adding the package acceptance script and public release/deploy/report gates.
- Wiring the institution, citizen and county interfaces to the command endpoint without duplicating state logic in UI code.

## Production boundary

Local authorization, idempotency, state transitions, receipts, fallbacks and consistency checks are functional evidence only. Production readiness still requires live provider callbacks, machine identities, signatures, network controls, transaction durability, messaging receipts, onsite responsibility signoff, cutover approval and rollback rehearsal.
