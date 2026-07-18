# Citizen service operations center

The citizen service operations center provides a runnable phase-2 operations MVP for resident-facing services. It reuses registration, internet nursing, escort and family-doctor orders instead of creating a separate order store.

## Operating model

| Area | Runtime collection | Supported demo actions | Production boundary |
|---|---|---|---|
| Banner, article and message publishing | `citizenOperationContents` | publish, withdraw, request review | Formal content approval and channel credentials |
| Agreement archive | `citizenAgreementVersions` | active and archived version display | Legal review, signed consent archive and official effective date |
| real-name review | `citizenIdentityReviewCases` | approve demo, reject, request material | Government identity source, guardian relationship and master-index verification |
| blacklist | `citizenServiceBlacklist` | activate demo, lift, manual review | Signed risk policy, appeal process and authoritative account/device identifiers |
| hospital service enablement | `citizenHospitalServiceConfigs` | white-list demo enablement, disable, request onsite confirmation | Hospital authorization, live service catalog, payment/refund and insurance callbacks |
| Cross-service order query | existing registration, nursing, escort and family-doctor collections | read-only status reconciliation | Live order source, payment and refund reconciliation |

All demo mutations keep `productionReady=false`. A local status such as `published-demo`, `approved-demo` or `active-demo` is evidence of workflow coverage only; it does not authorize production access.

## APIs

- `GET /api/citizen-operations/center`: commission-only operations center with content, agreements, real-name review, blacklist, hospital service enablement, orders and blockers.
- `GET /api/citizen-operations/public`: role-authenticated public feed containing published content, active agreements and demo-enabled hospital services. Sensitive review and blacklist data are excluded.
- `POST /api/citizen-operations/contents/:id/actions`: publish or withdraw demo content.
- `POST /api/citizen-operations/identity-reviews/:id/actions`: approve, reject or request additional material.
- `POST /api/citizen-operations/blacklist/:id/actions`: activate, lift or review a blacklist record.
- `POST /api/citizen-operations/hospitals/:id/actions`: enable or disable a demo hospital, or request onsite confirmation.

Every mutation requires a note and writes a `citizen-operations-action` security audit event.

## Acceptance evidence

1. The platform page displays operations metrics, identity review actions, hospital service enablement, content/agreement/blacklist governance and a cross-service order table.
2. The resident page consumes only the public API projection and displays published content, current agreements and visible hospital services.
3. Commission actions persist in the configured runtime data store, produce security events and never set a production-ready flag.
4. `phase2:citizen-operations-readiness` validates the data model, order reuse, API/UI contracts, documentation, release artifact and deployment checks.
5. Formal launch remains blocked until government identity, live hospital/payment callbacks, legal agreement approval and signed operating policies are recorded.
