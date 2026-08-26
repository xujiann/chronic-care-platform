# First production release scope

## Purpose

`config/production-release-scope.json` is the machine-readable boundary for the first production portfolio. It selects existing authorities and freezes their derived inventories; it is not a second source of application, API, collection or worker behavior.

Run:

```powershell
npm run production:release-scope:verify
```

The expected result is `ok: true`, `status: FROZEN-NO-GO` and `productionReady: false`.

## Frozen inventory

| Inventory | Count | Authority |
| --- | ---: | --- |
| Applications | 8 | `health-dashboard-applications.js` |
| Pages | 9 | application entries plus `login.html`, checked against static publication |
| APIs | 32 | 28 application routes plus 4 base APIs, checked against the production API catalog |
| Data references | 38 | application collection declarations, collection governance and explicit source bindings |
| Worker profiles | 7 | worker observability contract |
| External dependencies | 14 | 12 joint-test interfaces plus PostgreSQL primary storage and object storage |
| Application evidence names | 16 | application acceptance-evidence declarations |
| Cutover action definitions | 14 | production cutover action registry; definitions are not completion evidence |

The scope fingerprint is `sha256:ec33706d5806e5bcf3c210a289ca124e188ff236dafc60ac2f4f1d538f5acca3`.

The selected applications are regional data sharing, referral and teleconsultation, quality and safety, operations dispatch, drug and consumable supervision, chronic follow-up, research sandbox and the health dashboard.

## Release-chain binding

- The production API catalog remains the authority for endpoint behavior and production review.
- The full source-derived command is a CI/build-time check because it reads repository governance authorities that are intentionally absent from the deployable artifact. The production deployment manifest embeds only the already-verified scope ID, fingerprint, counts and fixed NO-GO boundary; it declares `runtimeVerificationAvailable=false`, and package verification rejects drift against the packaged frozen config.
- The standard smoke suite validates the frozen scope before runtime smoke assertions.
- Strict production preflight has an explicit release-scope software check in addition to package verification.

## Current blockers

Repository verification currently identifies 13 scoped APIs needing behavior review and no scoped data reference needing owner/governance review. The first four repository behavior gaps are closed by direct T04/T05 endpoint contracts, while all scoped APIs remain catalogued as production NO-GO. The 19 reviewed legacy collections, the exact T05 `referrals` owner binding and the T00 `operationsReadiness` derived read model remain production-write blocked until their explicit migration/promotion standards are met, so the scope reports 21 blocked data references without inventing repository readiness. Worker activation, external joint-test results, signed cutover evidence, PostgreSQL primary selection and site acceptance remain external or release-specific work.

No generated report, external evidence, completion status or production authorization is created by this verifier.

## Change procedure

1. Approve the release-scope change and its architecture impact.
2. Update the existing application, API, data, worker or external-dependency authority first.
3. Update the selector only when membership intentionally changes.
4. Regenerate and review inventory digests and the scope fingerprint.
5. Update the ADR and six architecture maps, then run the scope, package, smoke and strict-preflight tests.
6. Never change `productionReady` to `true` in repository metadata; supply verified release-bound evidence through the production preflight process instead.
