# Emergency golden four-minute life chain

## Seven delivered capabilities

1. **Golden four-minute coordination**: on SOS acceptance, creates nearby verified-responder tasks with AED/CPR guidance while preserving 120 dispatcher authority.
2. **Pre-authorized device risk alert**: a resident explicitly authorizes a device and permitted signals; only a risk score at or above 60 can create an automatic P1 information-queue SOS.
3. **Green-channel pre-alert**: chest-pain and stroke signals select an eligible hospital capability and create a pre-alert. Hospital acceptance remains a human confirmation.
4. **Family emergency collaboration**: only resident-authorized emergency contacts receive a notification task, with a masked contact reference in the operational view.
5. **Emergency command projection**: emergency center/hospital roles can view active events, vehicles, hospitals, AED reference sites, responder workload, and capacity-gap indicators.
6. **Weak-network life line**: weak/offline device reports create an auditable SMS/location fallback delivery task; a certified messaging gateway is still required before transmission.
7. **Quality and review dashboard**: summarizes automatic SOS, responder-task coverage, hospital pre-alert confirmation, weak-network fallback, and closed-loop evidence status.

```mermaid
flowchart LR
  D["Authorized device multi-signal risk"] --> R{"Risk score >= 60"}
  R -->|"yes"| S["P1 SOS information queue"]
  R -->|"no"| N["No automatic submission"]
  S --> F["Verified responder and AED task"]
  S --> G["Hospital green-channel pre-alert"]
  S --> H["Authorized family notification task"]
  S --> W{"Weak/offline network"}
  W -->|"yes"| X["Certified SMS/location fallback task"]
  F --> C["120 dispatcher and on-scene care"]
  G --> C
  H --> C
  C --> Q["Quality dashboard and evidence package"]
```

## API surface

- `POST /api/emergency/life-chain/authorizations`
- `POST /api/emergency/life-chain/family-contacts`
- `POST /api/emergency/life-chain/device-sos`
- `GET /api/emergency/life-chain/overview`
- `GET /api/emergency/life-chain/command-center`
- `GET /api/emergency/life-chain/quality`
- `POST /api/emergency/events/:id/green-channel/confirm`

## Safety and production boundary

- The platform is supplementary to the official 120 path. Device SOS submits information to the 120 queue; a webpage cannot silently call 120 or bypass the mobile operating-system confirmation.
- Automatic SOS requires resident authorization, a configured device, an allow-listed signal, and a risk score threshold. It must have cancellation, false-positive review, consent withdrawal, device attestation, and audit controls in production.
- Responder, AED, vehicle, hospital-capacity, SMS, wearable, and emergency-center feeds in this release are platform workflow/reference data. Real dispatch, message transmission, and clinical acceptance require signed interfaces, current authoritative registries, privacy/security assessment, joint testing, and site evidence.

## Verification

`npm run emergency:test` verifies authorization denial, signal threshold, automatic SOS, responder/AED coordination, family task, weak-network fallback, hospital confirmation, citizen scope, and quality projection. `npm run emergency:readiness`, `npm run deploy:check`, and `npm run release:report` retain the functional-versus-formal-go-live boundary.
