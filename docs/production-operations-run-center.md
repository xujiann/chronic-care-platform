# Production operations and disaster-recovery run center

## Purpose

The run center extends the existing hospital operations dashboard with production-oriented service levels, a 24x365 duty template, incident response, recovery rehearsals and evidence packets. It reuses runtime metrics, monitoring readiness, storage backup/restore tools, audit retention and release gates.

## Operating model

| Area | Local executable capability | Production requirement |
|---|---|---|
| Service levels | Four API, integration, data-quality and recovery policies | Signed SLO/OLA baseline and live monitoring rules |
| 24x365 duty | Day, night and release/emergency handoff templates | Named roster, duty phone, backup contact and escalation agreement |
| Incidents | Acknowledge, escalate, demo-resolve and request-onsite actions | Live paging, ticket system, command bridge and incident review |
| Recovery | Backup/restore, application rollback and identity fallback scenarios | Remote backup, full-volume restore/failover and measured production RPO/RTO |
| Evidence | Local rehearsal digest and operator evidence references | Screenshots, tickets, logs and multi-party signatures |

The recovery policy target is RPO <= 120 minutes and RTO <= 720 minutes. A local rehearsal can record sample measurements and checks, but it does not prove full-volume production recovery.

## APIs

- `GET /api/production-operations/center` returns service levels, duty shifts, incident lanes, recovery drills, evidence packets, runtime signals and blockers.
- `POST /api/production-operations/incidents/:id/actions` acknowledges, escalates or demo-resolves an incident, or requests onsite handling.
- `POST /api/production-operations/duty-shifts/:id/actions` records a demo handoff or requests the signed onsite roster.
- `POST /api/production-operations/drills/:id/actions` records a local rehearsal, an evidence reference or an onsite rehearsal request.
- Every mutation writes a `production-operations-action` event to the sealed audit chain.

## Production approval boundary

All local rows remain `productionReady=false`, and evidence packets remain `productionEvidence=false`. Production approval requires:

1. A signed 24x365 roster, duty phone tree and escalation owners.
2. A remote backup target, retention policy and production backup manifest.
3. A full-volume restore, failover and rollback rehearsal with measured RPO/RTO.
4. Production monitoring, SIEM, paging and ticket-channel integration.
5. A multi-party disaster-recovery report and go-live signoff.

Run `npm run operations:readiness` to generate the JSON and Markdown evidence artifacts.
