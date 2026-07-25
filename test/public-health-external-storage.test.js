const assert = require("node:assert/strict");
const fs = require("node:fs");
const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "public-health-external-storage-"));
fs.copyFileSync(path.join(ROOT, "data", "db.json"), path.join(dataDir, "db.json"));
process.env.NODE_ENV = "test";
process.env.DATA_DIR = dataDir;
process.env.STORAGE_ENGINE = "sqlite";
process.env.POSTGRES_SYNC_MODE = "disabled";

const {
  ensureDatabase,
  readDatabase,
  writeDatabase
} = require("../server");
const {
  signPublicHealthExternalContractAttestation
} = require("../public-health-external-contract-governance-service");

const CONTRACT_SECRET = "storage-contract-secret-1234567890-123456";
const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");

function signedTransition({
  fromContract,
  toContract,
  issuedAt,
  effectiveAt,
  sunsetAt,
  producerApprovedAt,
  consumerApprovedAt
}) {
  const version = Number(toContract.match(/-v(\d+)$/)?.[1]);
  return signPublicHealthExternalContractAttestation({
    laneId: "immunization",
    fromContract,
    toContract,
    requestSchemaVersion: `public-health-external-dispatch/v${version}`,
    receiptSchemaVersion: `public-health-external-receipt/v${version}`,
    changeType: "additive",
    fieldDictionaryDigest: digest(`storage-fields:${toContract}`),
    sampleRequestDigest: digest(`storage-request:${toContract}`),
    sampleReceiptDigest: digest(`storage-receipt:${toContract}`),
    runtimeReleaseDigest: digest(`storage-runtime:${toContract}`),
    producerApproval: {
      organizationId: "storage-producer",
      role: "producer-contract-owner",
      approverIdHash: digest(`storage-producer:${toContract}`),
      approvedAt: producerApprovedAt
    },
    consumerApproval: {
      organizationId: "storage-consumer",
      role: "consumer-contract-owner",
      approverIdHash: digest(`storage-consumer:${toContract}`),
      approvedAt: consumerApprovedAt
    },
    evidenceRefs: [`fields:${toContract}`, `joint:${toContract}`, `rollback:${toContract}`],
    effectiveAt,
    sunsetAt,
    status: "approved",
    issuedAt,
    expiresAt: new Date(new Date(sunsetAt).getTime() + 86_400_000).toISOString()
  }, CONTRACT_SECRET);
}

test.after(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("SQLite atomically persists dispatch and lane-control state under dual CAS", () => {
  ensureDatabase();
  const initial = readDatabase();
  initial.publicHealthExternalDispatches = [{
    id: "ph-storage-dispatch-1",
    laneId: "immunization",
    outboxVersion: 1
  }];
  initial.publicHealthExternalDispatchAudit = [];
  initial.publicHealthExternalLaneControls = [{
    laneId: "immunization",
    version: 0
  }];
  initial.publicHealthExternalLaneControlAudit = [];
  writeDatabase(initial, { event: "public-health-external-storage-seed" });

  const current = readDatabase();
  const next = structuredClone(current);
  next.publicHealthExternalDispatches[0].outboxVersion = 2;
  next.publicHealthExternalDispatchAudit.push({
    id: "ph-storage-dispatch-audit-1",
    dispatchId: "ph-storage-dispatch-1"
  });
  next.publicHealthExternalLaneControls[0].version = 1;
  next.publicHealthExternalLaneControlAudit.push({
    id: "ph-storage-lane-audit-1",
    laneId: "immunization"
  });
  writeDatabase(next, {
    event: "public-health-external-claim",
    publicHealthExternalCas: {
      dispatchId: "ph-storage-dispatch-1",
      expectedOutboxVersion: 1,
      laneId: "immunization",
      expectedLaneControlVersion: 0
    }
  });

  const persisted = readDatabase();
  assert.equal(persisted.publicHealthExternalDispatches[0].outboxVersion, 2);
  assert.equal(persisted.publicHealthExternalDispatchAudit.length, 1);
  assert.equal(persisted.publicHealthExternalLaneControls[0].version, 1);
  assert.equal(persisted.publicHealthExternalLaneControlAudit.length, 1);

  const stale = structuredClone(persisted);
  stale.publicHealthExternalDispatches[0].outboxVersion = 3;
  stale.publicHealthExternalDispatchAudit.push({
    id: "ph-storage-dispatch-audit-stale",
    dispatchId: "ph-storage-dispatch-1"
  });
  stale.publicHealthExternalLaneControls[0].version = 2;
  stale.publicHealthExternalLaneControlAudit.push({
    id: "ph-storage-lane-audit-stale",
    laneId: "immunization"
  });
  assert.throws(() => writeDatabase(stale, {
    event: "public-health-external-stale-attempt",
    publicHealthExternalCas: {
      dispatchId: "ph-storage-dispatch-1",
      expectedOutboxVersion: 1,
      laneId: "immunization",
      expectedLaneControlVersion: 0
    }
  }), /dispatch CAS conflict/);

  const unchanged = readDatabase();
  assert.equal(unchanged.publicHealthExternalDispatches[0].outboxVersion, 2);
  assert.equal(unchanged.publicHealthExternalDispatchAudit.length, 1);
  assert.equal(unchanged.publicHealthExternalLaneControls[0].version, 1);
  assert.equal(unchanged.publicHealthExternalLaneControlAudit.length, 1);
});

test("sequential contract attestations share the outbox and resilience transaction", () => {
  const first = signedTransition({
    fromContract: "immunization-registry-v1",
    toContract: "immunization-registry-v2",
    producerApprovedAt: "2026-07-23T06:00:00.000Z",
    consumerApprovedAt: "2026-07-23T07:00:00.000Z",
    issuedAt: "2026-07-23T08:00:00.000Z",
    effectiveAt: "2026-07-24T00:00:00.000Z",
    sunsetAt: "2026-08-24T00:00:00.000Z"
  });
  const current = readDatabase();
  const next = structuredClone(current);
  next.publicHealthExternalDispatches[0].outboxVersion = 3;
  next.publicHealthExternalLaneControls[0].version = 2;
  next.publicHealthExternalContractAttestations = [first];
  next.publicHealthExternalContractGovernanceAudit = [{
    id: "contract-audit-accepted",
    laneId: "immunization",
    fromContract: "immunization-plan-v1",
    result: "accepted"
  }];
  writeDatabase(next, {
    event: "public-health-contract-atomic-write",
    publicHealthExternalCas: {
      dispatchId: "ph-storage-dispatch-1",
      expectedOutboxVersion: 2,
      laneId: "immunization",
      expectedLaneControlVersion: 1
    },
    publicHealthExternalContractInsert: {
      attestation: first,
      signingMaterial: CONTRACT_SECRET,
      at: first.issuedAt
    }
  });

  const persisted = readDatabase();
  assert.equal(persisted.publicHealthExternalDispatches[0].outboxVersion, 3);
  assert.equal(persisted.publicHealthExternalLaneControls[0].version, 2);
  assert.equal(persisted.publicHealthExternalContractAttestations.length, 1);
  assert.equal(persisted.publicHealthExternalContractGovernanceAudit.length, 1);

  const second = signedTransition({
    fromContract: "immunization-registry-v2",
    toContract: "immunization-registry-v3",
    producerApprovedAt: "2026-08-25T06:00:00.000Z",
    consumerApprovedAt: "2026-08-25T07:00:00.000Z",
    issuedAt: "2026-08-25T08:00:00.000Z",
    effectiveAt: "2026-08-26T00:00:00.000Z",
    sunsetAt: "2026-09-26T00:00:00.000Z"
  });
  const chained = structuredClone(persisted);
  chained.publicHealthExternalDispatches[0].outboxVersion = 4;
  chained.publicHealthExternalLaneControls[0].version = 3;
  chained.publicHealthExternalContractAttestations.push(second);
  chained.publicHealthExternalContractGovernanceAudit.push({
    id: "contract-audit-chained",
    laneId: "immunization",
    fromContract: "immunization-registry-v2",
    result: "accepted"
  });
  writeDatabase(chained, {
    event: "public-health-contract-chained-write",
    publicHealthExternalCas: {
      dispatchId: "ph-storage-dispatch-1",
      expectedOutboxVersion: 3,
      laneId: "immunization",
      expectedLaneControlVersion: 2
    },
    publicHealthExternalContractInsert: {
      attestation: second,
      signingMaterial: CONTRACT_SECRET,
      at: second.issuedAt
    }
  });

  const afterChain = readDatabase();
  assert.equal(afterChain.publicHealthExternalDispatches[0].outboxVersion, 4);
  assert.equal(afterChain.publicHealthExternalLaneControls[0].version, 3);
  assert.deepEqual(
    afterChain.publicHealthExternalContractAttestations.map((item) => item.fromContract),
    ["immunization-registry-v1", "immunization-registry-v2"]
  );

  const conflicting = structuredClone(persisted);
  const conflictingAttestation = { ...second, toContract: "immunization-registry-v3-forged" };
  conflicting.publicHealthExternalContractAttestations.push(conflictingAttestation);
  conflicting.publicHealthExternalContractGovernanceAudit.push({
    id: "contract-audit-overwrite",
    result: "accepted"
  });
  assert.throws(() => writeDatabase(conflicting, {
    event: "public-health-contract-conflicting-write",
    publicHealthExternalContractInsert: {
      attestation: conflictingAttestation,
      signingMaterial: CONTRACT_SECRET,
      at: "2026-08-25T09:00:00.000Z"
    }
  }), /contract-transition-conflict/);

  const invalidChainCases = [{
    code: "contract-transition-disconnected",
    attestation: signedTransition({
      fromContract: "immunization-registry-v4",
      toContract: "immunization-registry-v5",
      producerApprovedAt: "2026-09-27T06:00:00.000Z",
      consumerApprovedAt: "2026-09-27T07:00:00.000Z",
      issuedAt: "2026-09-27T08:00:00.000Z",
      effectiveAt: "2026-09-28T00:00:00.000Z",
      sunsetAt: "2026-10-28T00:00:00.000Z"
    })
  }, {
    code: "contract-transition-approval-order-invalid",
    attestation: signedTransition({
      fromContract: "immunization-registry-v3",
      toContract: "immunization-registry-v4",
      producerApprovedAt: "2026-08-25T07:30:00.000Z",
      consumerApprovedAt: "2026-08-25T07:45:00.000Z",
      issuedAt: "2026-09-27T08:00:00.000Z",
      effectiveAt: "2026-09-28T00:00:00.000Z",
      sunsetAt: "2026-10-28T00:00:00.000Z"
    })
  }, {
    code: "contract-transition-window-overlap",
    attestation: signedTransition({
      fromContract: "immunization-registry-v3",
      toContract: "immunization-registry-v4",
      producerApprovedAt: "2026-09-10T06:00:00.000Z",
      consumerApprovedAt: "2026-09-10T07:00:00.000Z",
      issuedAt: "2026-09-10T08:00:00.000Z",
      effectiveAt: "2026-09-20T00:00:00.000Z",
      sunsetAt: "2026-10-20T00:00:00.000Z"
    })
  }];
  invalidChainCases.forEach(({ code, attestation }) => {
    const invalid = structuredClone(afterChain);
    invalid.publicHealthExternalContractAttestations.push(attestation);
    invalid.publicHealthExternalContractGovernanceAudit.push({
      id: `contract-audit-${code}`,
      result: "accepted"
    });
    assert.throws(() => writeDatabase(invalid, {
      event: `public-health-contract-${code}`,
      publicHealthExternalContractInsert: {
        attestation,
        signingMaterial: CONTRACT_SECRET,
        at: attestation.issuedAt
      }
    }), new RegExp(code));
  });

  const unchanged = readDatabase();
  assert.equal(unchanged.publicHealthExternalDispatches[0].outboxVersion, 4);
  assert.equal(unchanged.publicHealthExternalLaneControls[0].version, 3);
  assert.equal(unchanged.publicHealthExternalContractAttestations.at(-1).toContract, "immunization-registry-v3");
  assert.equal(unchanged.publicHealthExternalContractGovernanceAudit.length, 2);
});

test("SQLite endpoint probe receipts persist with receiptId and nonce uniqueness", () => {
  const current = readDatabase();
  const receipt = {
    receiptId: "ph-storage-endpoint-receipt-001",
    nonce: "ph-storage-endpoint-nonce-001",
    laneId: "immunization",
    adapterId: "ph-adapter-immunization"
  };
  const accepted = structuredClone(current);
  accepted.publicHealthExternalEndpointProbeReceipts = [receipt];
  writeDatabase(accepted, {
    event: "public-health-endpoint-probe-storage",
    publicHealthEndpointProbeInsert: { receipt }
  });

  const persisted = readDatabase();
  assert.equal(persisted.publicHealthExternalEndpointProbeReceipts.length, 1);
  assert.equal(persisted.publicHealthExternalEndpointProbeReceipts[0].receiptId, receipt.receiptId);

  const duplicateReceiptId = structuredClone(persisted);
  const receiptIdConflict = {
    ...receipt,
    nonce: "ph-storage-endpoint-nonce-002"
  };
  duplicateReceiptId.publicHealthExternalEndpointProbeReceipts.push(receiptIdConflict);
  assert.throws(() => writeDatabase(duplicateReceiptId, {
    event: "public-health-endpoint-probe-receipt-id-conflict",
    publicHealthEndpointProbeInsert: { receipt: receiptIdConflict }
  }), /receiptId unique conflict/);

  const duplicateNonce = structuredClone(persisted);
  const nonceConflict = {
    ...receipt,
    receiptId: "ph-storage-endpoint-receipt-002"
  };
  duplicateNonce.publicHealthExternalEndpointProbeReceipts.push(nonceConflict);
  assert.throws(() => writeDatabase(duplicateNonce, {
    event: "public-health-endpoint-probe-nonce-conflict",
    publicHealthEndpointProbeInsert: { receipt: nonceConflict }
  }), /nonce unique conflict/);

  const unchanged = readDatabase();
  assert.equal(unchanged.publicHealthExternalEndpointProbeReceipts.length, 1);
});
