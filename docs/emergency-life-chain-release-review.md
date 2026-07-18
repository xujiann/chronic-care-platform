# Emergency life-chain release review

## Scope reviewed

Resident SOS and AED guidance, device auto-alert, 120 information queue, first-aid responder task, family notice task, weak-network fallback task, hospital green-channel pre-alert, handover evidence, quality review, and release gates.

## Improvements included in this release candidate

| Risk found | Improvement | Verifiable control |
|---|---|---|
| Wearable retransmission could create repeat P1 events | Suppress a replayed source signal or a same-device/same-signal report within 120 seconds | `emergencySosSignalLog` stores `suppressed-duplicate`; API returns the original event without reopening native `tel:120` |
| Patient could enable but not withdraw auto SOS | Add resident-scoped authorization revocation | `POST /api/emergency/life-chain/authorizations/:id/revoke` disables the device and writes an audit event |
| False positives had no safe reversal path | Add patient request and 120-only human resolution | Queue is never automatically cancelled; withdrawal is allowed only before dispatch and only after an emergency-center decision |
| A hospital account could confirm another hospital's pre-alert | Bind green-channel confirmation and hospital views to the target hospital `orgCode` | Institution APIs expose only target-hospital pre-alerts and reject mismatched confirmation |
| Device safety controls were not visible in evidence | Add automatic-SOS consent/control evidence section | Evidence package includes authorization, signal, risk score, source signal reference, and review status when automatic SOS is used |
| A single platform account could release a site blocker | Require external provenance and independent site-evidence verification | Evidence submission requires an external signer, organization and SHA-256 digest; a different responsible person must verify the same digest before an endpoint becomes production-ready |

## Release decision

- Emergency functional state: `ready-for-site-integration` after targeted automated verification.
- Formal production state: `blocked-until-site-evidence-signed`.
- The candidate must not be represented as a live 120 dispatch, SMS, AED registry, hospital-capacity, or wearable-device integration until interfaces, security/privacy assessment, joint drills, and accountable site sign-off are complete.

## Required production evidence

1. 120 CTI/recording and queue handoff are jointly tested and signed.
2. Mobile location, certified SMS fallback, wearable attestation, AED registry, vehicle telemetry, and hospital capacity interfaces are verified against authoritative sources.
3. Privacy/security assessment, availability/backup drill, and operational duty roster are accepted.
4. Pilot hospital completes green-channel and electronic-handover joint drill.
