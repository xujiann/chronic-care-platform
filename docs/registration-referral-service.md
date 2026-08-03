# Registration, Referral and Family Doctor Closure Service

## Scope

`registration-referral-service.js` is the API-independent command layer for the T05 workflow. It composes the existing registration journey and callback functions with primary-care, referral continuity, exception handling, notification reliability, chronic follow-up and family doctor lifecycle commands. Independently deployable T05 operations are isolated in `registration-referral-standalone.js` and still execute through the same authorization, idempotency and audit wrapper.

Every command requires a unique `commandId`. The service binds that key to a SHA-256 fingerprint covering the normalized action, case, resident, payload, supplied timestamp, actor identity and scope, plus the notification fallback policy when relevant. Only an exact replay is idempotent; altered requests, actors and legacy audit rows without a fingerprint fail with `idempotency key conflict`.

Commands may include `expectedVersion`. When the persistence adapter selects `requireExpectedVersion=true`, every update to an existing aggregate must match its current `workflowVersion`; stale commands fail before mutation. Successful commands increment the aggregate version and record it in the closure event. `replayClosureCommands` replays an ordered journal, preserves exact idempotent duplicates and stops with the failed journal index when recovery cannot continue safely.

Each new closure event contains `previousEventHash` and a canonical SHA-256 `eventHash`. `validateClosureEventChain` detects payload changes, broken links and duplicate command identifiers. The oldest retained event may carry an external anchor because the in-memory collection is bounded.

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

## Standalone T05 operations

The complete catalog contains 45 commands. In addition to the 14 closure commands above, T05 implements these operations without changing a public route or shared page:

- Referral exceptions: `reject-referral-request`, `withdraw-referral`, `reassign-referral`, `reschedule-teleconsultation`, `cancel-teleconsultation` and `record-teleconsultation-no-show`.
- Clinical package and consent: `attach-referral-materials`, `grant-referral-authorization`, `revoke-referral-authorization` and `resume-referral-authorization`. Resident or guardian grants must specify covered institutions, expiry and the minimum permitted data scopes.
- SLA and messaging reliability: `run-closure-sla`, `acknowledge-escalation`, `record-notification-provider-result` and `resolve-notification-dead-letter`.
- Family doctor lifecycle: `submit-family-doctor-application`, `review-family-doctor-application`, `activate-family-doctor-contract`, `record-family-doctor-fulfillment`, `request-family-doctor-renewal`, `review-family-doctor-renewal` and `terminate-family-doctor-contract`.
- Family doctor transfer: `request-family-doctor-transfer` opens a resident-scoped transfer, while two `review-family-doctor-transfer` decisions require the current team to release responsibility before the target team can accept it. Completion moves the contract, synchronizes both team capacities, cancels obsolete open service tasks and retains transfer history.
- Family doctor quality remediation: `raise-family-doctor-service-dispute`, `respond-family-doctor-service-dispute` and `acknowledge-family-doctor-service-dispute` bind a resident complaint to one completed fulfillment, require an exact-scope institution response, allow the resident to reopen an unsatisfactory resolution, and close only after resident acceptance.
- Advanced continuity: `create-down-referral` creates a hospital-to-primary-care handoff, while `request-referral-supplement`, `submit-referral-supplement` and `review-referral-supplement` provide a versioned two-party material correction loop.
- Family doctor operations: `run-family-doctor-scheduler` creates scoped service, renewal and expiry tasks. A later `record-family-doctor-fulfillment` may reference `serviceTaskId` and closes the task atomically with the fulfillment record.

`buildClosureWorkQueue` produces a role-scoped queue with overdue hours and priority. `buildClosureQualityMetrics` reports referral return, continuity, rejection, reassignment, repeat-exam reuse, material-manifest and family-doctor indicators. `buildNotificationReliability` reports provider receipts and dead-letter closure. All three are read-only and retain `productionReady=false`.

Clinical material commands store only metadata, record identifiers, versions and SHA-256 digests. Binary files and signed document storage remain an object-storage integration responsibility.

## Authorization

- Commission users can operate across organizations for supervision and reconciliation.
- Institution commands that operate on institution-scoped data require `orgCode` and enforce an exact source or target institution match.
- Citizen acknowledgements require the message, fulfillment or follow-up resident to be in the actor's resident scope.
- Notification access additionally checks `targetRole` and `targetOrgCode`.
- Referral creation requires an active resident authorization and a resident-consistent target chain.
- Referral reassignment requires a new active authorization that explicitly covers the new target institution.
- Authorization revocation is resident scoped and places every linked non-terminal referral on hold.

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
4. Call `applyClosureCommand(data, command, user, { requireExpectedVersion: true })` for version-protected production writes.
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
- Initializing `primaryCareAssessments`, `registrationReferralClosureEvents`, `registrationReferralEscalations`, `registrationReferralNotificationDeadLetters`, `phase2FamilyDoctorServiceTasks` and `phase2FamilyDoctorServiceDisputes` as empty collections for a fresh database.
- Adding the package acceptance script and public release/deploy/report gates.
- Wiring the institution, citizen and county interfaces to the command endpoint without duplicating state logic in UI code.

## Production boundary

Local authorization, idempotency, state transitions, receipts, fallbacks and consistency checks are functional evidence only. Production readiness still requires live provider callbacks, machine identities, signatures, network controls, transaction durability, messaging receipts, onsite responsibility signoff, cutover approval and rollback rehearsal.
