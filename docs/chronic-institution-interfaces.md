# Chronic Follow-Up Institution Interface Specification

This document defines the pre-launch interface boundary between the chronic follow-up module and connected medical institutions, family doctor systems, pharmacy systems, device gateways, and message channels.

## Scope

The module is responsible for chronic screening follow-up, tiered management review, post-discharge follow-up, return visit reminders, medication adherence, resident feedback, field measurements, pharmacy callbacks, family doctor closure, and senior reminder outreach.

All write interfaces must keep resident authorization, institution scope, message closure, and audit evidence. The runtime evidence is checked by `npm run chronic:institution-interfaces`, `npm run chronic:followup-readiness`, and `npm run release:report`.

Runtime audit endpoint: `GET /api/chronic/institution-interfaces`.

## Common Rules

- Authentication: Bearer session token from `/api/auth/login`.
- Authorization: every resident-scoped request must pass `canAccessResident`.
- Audit: successful and denied writes must create security or data-access evidence.
- Idempotency: external callbacks should send `externalId` when available.
- Time: use ISO 8601 strings for callback and measurement timestamps.
- Encoding: request and response bodies are JSON with `Content-Type: application/json`.
- Error contract: `400` for missing fields, `403` for role or resident-scope denial, `404` for unknown business ids.

## Contracts

### chronic-followup-summary-v1

- Endpoint: `GET /api/chronic/followup-summary`
- Owner: medical institution
- Roles: `commission`, `institution`, `citizen`
- Direction: platform to institution or resident portal
- Required query fields: optional `residentId`
- Response fields: `summary`, `alertQueue`, `policyAlignment`, `residents`
- Evidence collections: `followups`, `chronicManagementPlans`, `chronicScreeningTasks`, `medicationPickups`, `taskMessages`
- Launch check: institution and citizen views consume the same risk queue.

### chronic-followup-feedback-v1

- Endpoint: `POST /api/chronic/followup-feedback`
- Owner: citizen and institution
- Roles: `citizen`, `institution`, `commission`
- Direction: inbound feedback
- Required body fields: `residentId`, optional `followupId`, `feedback` or `result`
- Optional fields: `medicationTaken`, `symptoms`, `satisfaction`, `nextRequest`
- Writes: `personalRecords`, `followups`, `taskMessages`, `securityEvents`, `dataAccessLogs`
- Launch check: resident feedback creates an institution task message.

### chronic-resident-checkin-v1

- Endpoint: `POST /api/chronic/resident-checkins`
- Owner: resident service
- Roles: `citizen`, `institution`, `commission`
- Direction: inbound self-management check-in
- Required body fields: `residentId`
- Optional fields: `measurementType`, `measurementValue`, `medicationPickupId`, `medicationTaken`, `satisfaction`, `proxyName`, `proxyRelation`, `seniorReminder`, `note`
- Writes: `personalRecords`, `chronicSelfManagement`, `medicationPickups`, `seniorServices`, `taskMessages`
- Launch check: check-in returns health points and review message id when review is needed.

### chronic-device-measurement-v1

- Endpoint: `POST /api/chronic/device-measurements`
- Owner: device gateway
- Roles: `citizen`, `institution`, `commission`
- Direction: inbound device measurement
- Required body fields: `residentId`, `measurementType`, `measurementValue`
- Optional fields: `externalId`, `deviceId`, `deviceType`, `reportedAt`, `medicationTaken`, `note`
- Writes: `personalRecords`, `chronicSelfManagement`, optional `taskMessages`
- Launch check: repeated `externalId` returns the existing record as an idempotent replay.

### chronic-pharmacy-callback-v1

- Endpoint: `POST /api/chronic/pharmacy-callbacks`
- Owner: pharmacy or HIS
- Roles: `institution`, `insurance`, `commission`
- Direction: inbound pharmacy callback
- Required body fields: `medicationPickupId`, `status`
- Optional fields: `externalId`, `pharmacyStatus`, `medicationTaken`, `pickupConfirmedAt`, `inventoryStatus`, `note`
- Writes: `medicationPickups`, `taskMessages`, `securityEvents`, `dataAccessLogs`
- Launch check: pickup status is updated and a resident-facing message is created.

### chronic-family-doctor-action-v1

- Endpoint: `POST /api/chronic/family-doctor-actions`
- Owner: family doctor system
- Roles: `institution`, `commission`
- Direction: inbound family doctor disposition
- Required body fields: `residentId`, `action`, `result`
- Optional fields: `messageId`, `taskId`, `nextAction`, `servicePack`
- Writes: `personalRecords`, `taskMessages`, `securityEvents`, `dataAccessLogs`
- Launch check: matched institution message is marked handled and a resident notice is created.

### chronic-reminder-outreach-v1

- Endpoint: `POST /api/chronic/reminder-outreach`
- Owner: message platform
- Roles: `institution`, `commission`
- Direction: outbound request record
- Required body fields: `residentId`, `channel`, `reminderType`
- Optional fields: `reason`, `scheduledAt`, `contact`, `status`
- Writes: `seniorServices`, `taskMessages`, `securityEvents`, `dataAccessLogs`
- Launch check: SMS, phone, or in-app reminder evidence is visible in readiness reports.

### chronic-followup-escalation-v1

- Endpoint: `POST /api/chronic/followup-escalations`
- Owner: medical institution
- Roles: `institution`, `commission`
- Direction: inbound priority escalation
- Required body fields: `collection` and `id`, or `alertId`
- Optional fields: `reason`, `escalationOwner`, `escalationLevel`, `status`
- Supported collections: `chronicScreeningTasks`, `chronicManagementPlans`, `followups`, `medicationPickups`
- Writes: business collection, `taskMessages`, `securityEvents`, `dataAccessLogs`
- Launch check: overdue and high-priority alerts can be escalated to an institution work queue with audit evidence.

### chronic-followup-dispatch-v1

- Endpoint: `POST /api/chronic/followup-dispatch`
- Owner: medical institution
- Roles: `institution`, `commission`
- Direction: inbound business disposition
- Required body fields: `collection`, `id`
- Optional fields: `updates`, `status`, `note`
- Supported collections: `chronicScreeningTasks`, `chronicManagementPlans`, `followups`, `medicationPickups`
- Writes: business collection, `taskMessages`, `securityEvents`, `dataAccessLogs`
- Launch check: institution messages are closed and residents receive a disposition update.

## Sample Payloads

```json
{
  "residentId": "r1",
  "externalId": "device-bp-r1-20260622",
  "deviceId": "bp-device-demo-001",
  "measurementType": "remote blood pressure",
  "measurementValue": "151/91 mmHg high",
  "medicationTaken": true
}
```

```json
{
  "medicationPickupId": "mp1",
  "externalId": "pharmacy-mp1-20260622",
  "status": "picked_up",
  "pharmacyStatus": "picked_up",
  "medicationTaken": true
}
```

```json
{
  "residentId": "r1",
  "action": "family doctor phone review",
  "result": "family doctor reviewed resident self-monitoring and updated plan",
  "nextAction": "continue home monitoring for 7 days"
}
```

## Pre-Launch Acceptance

- Run `npm run chronic:institution-interfaces` and confirm all 8 contracts pass.
- Run `npm run chronic:followup-readiness` and confirm `field-integration-closure` passes.
- Run `npm run release:report` and confirm `chronicFollowup:institutionInterfaces` and `chronicFollowup:fieldIntegration` pass.
- Confirm site-specific interface signoff remains a production cutover item through `CUTOVER_SITE_INTERFACE_SIGNOFF`.
