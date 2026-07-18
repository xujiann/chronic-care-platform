# Chronic launch core readiness

This document defines the first five production-facing work packages for the chronic disease management and post-discharge follow-up module. It complements `docs/chronic-institution-interfaces.md` and is generated as `chronic-launch-core` release evidence by `npm run chronic:launch-core`.

## Scope

| Item | Runtime evidence | Acceptance focus |
|---|---|---|
| Medical institution system integration | `chronicExternalIntegrations`, `/api/chronic/institution-interfaces`, `/api/chronic/launch-core` | HIS/EMR/LIS/PACS, pharmacy and follow-up dispatch fields have signed payload examples, idempotency keys, receipt status and audit paths. |
| Production identity and organization scope | `chronicIdentityScopes`, identity contract, `canAccessResident`, `scopeStateForUser` | Government OIDC/SAML claims map to roles, organizations, resident identity and minimum necessary access. |
| Message channel receipts and escalation | `chronicMessageChannels`, `/api/chronic/reminder-outreach`, `taskMessages.receipts` | SMS, phone and in-app channels have receipt fields, retry policy, escalation timeout and fallback owner. |
| Chronic quality model governance | `chronicModelGovernance`, `diseaseRegistryModels`, `chronicQualityMetrics` | Hypertension and diabetes thresholds have versioned model IDs, manual review owners and sampling rules. |
| Pharmacy and insurance settlement closure | `chronicPharmacyInsuranceLinks`, `medicationPickups`, `insuranceClaims`, `/api/chronic/pharmacy-callbacks` | Long prescription, drug catalog version, pickup callback and insurance review status are linked for each pilot resident. |

## API

- `GET /api/chronic/launch-core`
  - Roles: `commission`, `institution`.
  - Returns the five launch core items, required field completeness, cross-evidence status and release checks.
  - The response is read-only and uses the current database snapshot.
- `POST /api/chronic/launch-core/actions`
  - Roles: `commission`, `institution`.
  - Records a closure action for one launch-core row and writes an audit event.
  - Supported `itemId` values: `institution-systems`, `identity-scope`, `message-channels`, `quality-model`, `pharmacy-insurance`, `site-readiness-pack`.
  - The response returns the updated row and a refreshed launch-core report.

## Release Gate

The `chronicFollowup:launchCore` release check passes only when all five core items are ready. It intentionally sits after the existing follow-up readiness and institution interface checks, so the module cannot be marked release-ready if only demo pages are present without field-level launch evidence.

The release evidence also includes `launch-core:actionClosure` and `launch-core:siteSignoffs`. These checks prove that the six pre-launch tasks have closure rows and signed site evidence:

- Institution system receipt and joint-test closure.
- Identity and organization scope review.
- Message receipt and escalation rehearsal.
- Quality model version and manual review closure.
- Pharmacy, prescription and insurance callback closure.
- Site readiness pack signoff.

## Site Joint-Test Boundary

The current implementation is ready for pilot joint-test with synthetic data and sample contracts. Before production cutover, each pilot institution still needs to sign off:

- HIS/EMR/LIS/PACS sample payloads and return receipts.
- Government identity source metadata and role/organization directory mapping.
- SMS, phone and in-app provider receipt examples.
- Hypertension and diabetes model threshold confirmation by clinical quality owners.
- Pharmacy inventory, long prescription and insurance settlement callback samples.
