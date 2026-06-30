# Internet nursing production blocker matrix

This note supplements the Internet+ Nursing site cutover pack.

`npm.cmd run internet-nursing:readiness` writes the production cutover state into:

- `release/internet-nursing-readiness-report.json`
- `release/internet-nursing-readiness-report.md`

The report now includes:

- `summary.productionBlockers`: unresolved production blocker count.
- `cutoverPack.productionReadiness`: `production-ready` only when runtime mode, storage, secrets, identity, audit retention, and site signoffs are complete.
- `cutoverPack.productionBlockers[]`: blocker `source`, `name`, `detail`, and `requiredAction`.
- Markdown section `Production Blockers`: a release-review table for implementation teams and site acceptance.

Typical required actions:

- Configure `NODE_ENV=production`.
- Switch `STORAGE_ENGINE` away from JSON for production runtime.
- Configure strong `SESSION_SECRETS` and `INTEGRATION_GATEWAY_SECRET`.
- Configure OIDC government identity variables.
- Configure `AUDIT_EXPORT_PATH` or `SIEM_ENDPOINT`.
- Archive signoff variables: `CUTOVER_SITE_INTERFACE_SIGNOFF`, `CUTOVER_INSURANCE_CERTIFICATE_SIGNOFF`, `CUTOVER_MONITORING_SIGNOFF`, and `CUTOVER_DR_REHEARSAL_SIGNOFF`.
