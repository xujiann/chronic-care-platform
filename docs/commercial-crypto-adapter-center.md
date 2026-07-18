# Commercial crypto adapter center

## Scope

The commercial crypto adapter center turns the phase-2 requirement into executable adapter contracts, runtime compatibility probes, evidence registration and onsite-verification requests. It covers GM TLS, signing and verification, important-data encryption, audit integrity, CA/USBKey identity and secure-browser compatibility.

The center deliberately does not implement custom cryptography. It exposes provider-neutral contracts so certified products, devices and services can be selected and connected onsite.

## Runtime compatibility probe

The local probe inspects the Node.js/OpenSSL registry for SM2, SM3 and SM4. Where supported, it runs an SM3 known-answer test and an SM4 encrypt/decrypt round trip. The result is runtime compatibility evidence only. Algorithm availability is not product certification, secure key-management proof, production approval or an official commercial-crypto assessment conclusion.

## Capability contracts

| Capability | Adapter boundary | Required onsite evidence |
|---|---|---|
| GM HTTPS | Certified GM TLS gateway or server adapter | Product qualification, production certificate chain, secure-browser compatibility |
| Signing and verification | Signing server, electronic seal and timestamp adapters | USBKey/signing-server configuration, timestamp receipt, seal approval |
| Data encryption | KMS, crypto appliance or database-encryption adapter | Key custody, rotation and recovery procedure; encrypted backup test |
| Audit integrity | SM3, trusted timestamp and WORM archive adapter | Retention policy, timestamp validation and recovery sample |
| CA and USBKey | CA trust and identity mapping adapter | CA agreement, certificate lifecycle and revocation validation |
| Secure browser | Browser and middleware compatibility adapter | Version matrix, managed-endpoint pilot and upgrade plan |

## APIs and audit

- `GET /api/commercial-crypto/center` returns contracts, the current runtime compatibility probe, probe history, evidence packets and blockers. It is commission-only.
- `POST /api/commercial-crypto/capabilities/:id/actions` accepts `run-runtime-probe`, `record-evidence` and `request-onsite` actions.
- Every action writes a `commercial-crypto-action` event into the sealed security audit chain.
- Evidence references are recorded as `pending-onsite-validation`; they are never promoted to production evidence by the demo action.

## Production approval boundary

Every adapter record is normalized to `productionReady=false`. Production approval remains blocked until all of the following are complete:

1. Certified commercial-crypto products and qualified suppliers are selected.
2. Production CA certificates, USBKey, signing server and timestamp service are configured.
3. Key generation, custody, rotation, recovery and destruction procedures are signed and rehearsed.
4. Database encryption, backup recovery and audit archive are verified onsite.
5. A third-party commercial-crypto assessment report and rectification signoff are archived.

Run `npm run security:commercial-crypto-readiness` to generate the JSON and Markdown readiness artifacts.
