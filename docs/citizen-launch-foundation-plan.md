# Citizen Launch Foundation Plan

## Phase 1 Scope

Phase 1 turns the resident portal into a controlled-pilot-ready mobile entry across mini-program, APP, and PWA channels. It does not claim that all production dependencies are connected. Instead, it makes identity, SMS, real-name verification, guardian verification, privacy, domain, app signing, push, monitoring, and upgrade requirements explicit release gates.

## Implemented Foundation

- Phone verification login has a demo code issuing endpoint, cooldown, expiry, masked phone response, and a visible mobile form.
- Mini-program and APP channel routing is available through `client=mini-program|app`.
- Resident service pages are shareable through `page=health-record|emr|nursing|escort|registration`.
- APP/PWA install readiness includes manifest identity, mobile meta tags, service worker caching, and shortcuts for health archive, EMR, escort, and APP preview.
- The resident page exposes copyable launch entry links and channel-specific launch checklists.

## Production Dependencies

| Dependency | Purpose | Phase 1 status |
| --- | --- | --- |
| SMS gateway | Replace demo code with production verification delivery and rate limits | Required before production |
| Real-name identity verification | Bind phone login to verified resident identity | Required before production |
| Guardian and household relation verification | Prevent unauthorized family-member access | Required before production |
| HTTPS domain and privacy filing | Satisfy mini-program, APP, and browser install policies | Required before production |
| App signing, push certificates, crash monitoring, upgrade channel | Support APP distribution and operations | Required before production |

## Acceptance Evidence

- `npm.cmd run citizen:launch-foundation`
- `node --test test/citizen-launch-foundation-readiness.test.js`
- `npm.cmd run check`

## Next Phase

Phase 2 should close the resident registration workflow: hospital schedule source, appointment confirmation, payment/insurance placeholder states, cancellation rules, and resident notifications.
