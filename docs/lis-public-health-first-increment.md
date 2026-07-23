# LIS positive-result to public-health direct-report first increment

## Delivered scope

This increment provides an independently testable code foundation for one pilot hospital LIS result to land in `diagnosticReports`, conditionally dispatch a minimized positive-result event to the public-health direct-report endpoint, retain a signed provider receipt, verify asynchronous callbacks, and compensate failed delivery through a bounded dead-letter replay.

The implementation deliberately keeps `productionReady` false. Code readiness does not replace the official reporting field version, the hospital and CDC network window, agency credentials, or a signed joint-test receipt.

## Contract boundary

The inbound contract remains `lis-report-v1`. The landing handler additionally requires `institutionCode` to make idempotency institution-scoped. Normal LIS reports only land in `diagnosticReports`.

Direct reporting is triggered only when all of the following are true:

- `publicHealthReportRequired` is explicitly true.
- `resultFlag` is `positive` or `critical`.
- `diseaseCode`, `itemCode`, and `eventType` are present.

The draft outbound contract is `public-health-direct-report-v1`. It sends versioned `hmac-sha256:v1` keyed subject and specimen pseudonyms instead of the platform resident identifier, person index, name, identity card number, phone number, or address. The HMAC key is independent from the request-signing key, is injected only by the deployment environment, and is never persisted or exposed. The official field dictionary may require a separately approved identity projection at site integration time; that projection must not be added before the processing basis and minimum-field approval are signed.

## Runtime controls

- HTTPS is mandatory in production.
- Outbound requests use HMAC-SHA256, stable JSON, request ID, timestamp, and institution-scoped idempotency key.
- Subject and specimen references use domain-separated `hmac-sha256:v1` pseudonyms. Missing reference keys always reject reportable events before persistence or dispatch; production keys shorter than 32 bytes are rejected.
- HTTP 429, 5xx, network errors, and timeouts have bounded retry; permanent failures enter dead letter.
- Callback verification uses a separate secret, a bounded timestamp window, nonce replay protection, and constant-time signature comparison.
- Inbound raw LIS payloads are not copied into the increment ledger. The ledger stores a SHA-256 digest and normalized business evidence.
- Public connector status responses omit endpoint, signing secret, callback secret, bearer token, resident identifier, subject reference, and callback nonce digest.

## Environment contract

The following variables must be injected by the deployment environment and must not be committed with real values:

```text
PUBLIC_HEALTH_DIRECT_REPORT_URL
PUBLIC_HEALTH_DIRECT_REPORT_SECRET
PUBLIC_HEALTH_REFERENCE_SECRET
PUBLIC_HEALTH_DIRECT_REPORT_TOKEN
PUBLIC_HEALTH_DIRECT_REPORT_CALLBACK_SECRET
PUBLIC_HEALTH_DIRECT_REPORT_TIMEOUT_MS
PUBLIC_HEALTH_DIRECT_REPORT_MAX_ATTEMPTS
PUBLIC_HEALTH_DIRECT_REPORT_CALLBACK_MAX_SKEW_SECONDS
```

## T00 integration hooks

T03 does not modify shared `server.js`, `package.json`, `README.md`, shared styles, or the release aggregate. T00 should wire the exported functions as follows:

1. Import `ingestLisReport`, `retryDirectReport`, `applyDirectReportCallback`, and `firstIncrementStatus` from `medical-public-health-integration.js`.
2. Import `directReportConnectorCenter` and `verifyDirectReportCallback` from `public-health-connectors.js`; import `issueCrossInstitutionAuthorization` only for server-approved relay flows.
3. After the existing `/api/integration/events` signature and contract checks, route `lis-report-v1` through `ingestLisReport` before persisting the shared state.
4. Add a commission/institution status route at `GET /api/public-health/direct-report/connector`.
5. Add an unauthenticated provider callback route protected by callback HMAC at `POST /api/public-health/direct-report/callback`.
6. Add a commission-only compensation route at `POST /api/public-health/direct-report/events/:id/retry`.
7. Merge `PUBLIC_HEALTH_DIRECT_REPORT_CONTRACT` into the shared `integrationContracts` registry without replacing site-owned contract versions.
8. Add the readiness script and both focused tests to the shared package and release gates.

T00 must persist the normalized state only after the handler returns and must append the shared security audit event without including raw LIS data, subject references, request bodies, or secrets. `PUBLIC_HEALTH_REFERENCE_SECRET` must come from server-side deployment configuration and must never be accepted from an API request. Cross-institution authorization must be created in-process with `issueCrossInstitutionAuthorization`; a request JSON object with the same fields is intentionally invalid.

## Sample inbound message

```json
{
  "contractId": "lis-report-v1",
  "idempotencyKey": "lis-report-v1|MR1|LAB-20260722-0001",
  "payload": {
    "externalId": "LAB-20260722-0001",
    "residentId": "TEST-PERSON-001",
    "personIndex": "TEST-MPI-001",
    "institutionCode": "MR1",
    "institutionName": "Pilot Hospital",
    "item": "Reportable pathogen nucleic acid",
    "itemCode": "TEST-LAB-001",
    "result": "detected",
    "resultFlag": "positive",
    "specimenNo": "SPECIMEN-001",
    "reportedAt": "2026-07-22T01:30:00.000Z",
    "occurredAt": "2026-07-22T01:20:00.000Z",
    "eventType": "infectious-disease-laboratory-positive",
    "diseaseCode": "TEST-DISEASE-001",
    "publicHealthReportRequired": true
  }
}
```

All identifiers and codes above are non-production test values.

## Acceptance evidence

The first site increment is accepted only after ten desensitized valid samples land correctly and receive real test-environment receipts, one duplicate produces no duplicate record, an invalid signature and a missing-field sample are rejected with audit evidence, a transient failure recovers within the configured attempts, and a permanent failure is replayed from dead letter with a signed evidence reference.

Required archived artifacts are the field mapping, request and response samples, signing digest log, gateway receipt, callback verification record, dead-letter replay record, target-record query screenshot, issue and retest ledger, and the hospital/CDC/platform signed joint-test receipt.
