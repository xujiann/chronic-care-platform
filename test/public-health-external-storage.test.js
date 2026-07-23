const assert = require("node:assert/strict");
const fs = require("node:fs");
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

test("contract attestation uniqueness shares the outbox and resilience transaction", () => {
  const current = readDatabase();
  const next = structuredClone(current);
  next.publicHealthExternalDispatches[0].outboxVersion = 3;
  next.publicHealthExternalLaneControls[0].version = 2;
  next.publicHealthExternalContractAttestations = [{
    laneId: "immunization",
    fromContract: "immunization-plan-v1",
    toContract: "immunization-plan-v2"
  }];
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
      laneId: "immunization",
      fromContract: "immunization-plan-v1"
    }
  });

  const persisted = readDatabase();
  assert.equal(persisted.publicHealthExternalDispatches[0].outboxVersion, 3);
  assert.equal(persisted.publicHealthExternalLaneControls[0].version, 2);
  assert.equal(persisted.publicHealthExternalContractAttestations.length, 1);
  assert.equal(persisted.publicHealthExternalContractGovernanceAudit.length, 1);

  const conflicting = structuredClone(persisted);
  conflicting.publicHealthExternalDispatches[0].outboxVersion = 4;
  conflicting.publicHealthExternalLaneControls[0].version = 3;
  conflicting.publicHealthExternalContractAttestations = [{
    laneId: "immunization",
    fromContract: "immunization-plan-v1",
    toContract: "immunization-plan-v2-forged"
  }];
  conflicting.publicHealthExternalContractGovernanceAudit.push({
    id: "contract-audit-overwrite",
    result: "accepted"
  });
  assert.throws(() => writeDatabase(conflicting, {
    event: "public-health-contract-conflicting-write",
    publicHealthExternalCas: {
      dispatchId: "ph-storage-dispatch-1",
      expectedOutboxVersion: 3,
      laneId: "immunization",
      expectedLaneControlVersion: 2
    },
    publicHealthExternalContractInsert: {
      laneId: "immunization",
      fromContract: "immunization-plan-v1"
    }
  }), /contract attestation unique conflict/);

  const unchanged = readDatabase();
  assert.equal(unchanged.publicHealthExternalDispatches[0].outboxVersion, 3);
  assert.equal(unchanged.publicHealthExternalLaneControls[0].version, 2);
  assert.equal(unchanged.publicHealthExternalContractAttestations[0].toContract, "immunization-plan-v2");
  assert.equal(unchanged.publicHealthExternalContractGovernanceAudit.length, 1);
});
