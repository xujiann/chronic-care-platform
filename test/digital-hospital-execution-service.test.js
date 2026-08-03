const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  MemoryExecutionRepository,
  SqliteExecutionRepository,
  assertExecutionPersistenceBoundary,
  createDigitalHospitalExecutionService
} = require("../digital-hospital-execution-service");

test("memory execution service exposes runtime metadata and never persists raw lease tokens", () => {
  const service = createDigitalHospitalExecutionService({
    repository: new MemoryExecutionRepository({
      environments: [{ id: "ENV-TEST", status: "healthy" }]
    })
  });
  service.registerWorker({
    id: "WORKER-TEST",
    capabilities: ["probe"],
    now: "2026-07-29T01:00:00.000Z"
  });
  service.enqueue({
    id: "JOB-TEST",
    connectorId: "CONN-TEST",
    environmentId: "ENV-TEST",
    jobType: "probe",
    idempotencyKey: "execution-service-test",
    payload: { sequence: 1 },
    now: "2026-07-29T01:00:01.000Z"
  });
  const claimed = service.claim({
    workerId: "WORKER-TEST",
    now: "2026-07-29T01:00:02.000Z"
  }).result;
  assert.equal(claimed.job.status, "running");
  assert.match(claimed.leaseToken, /^lease-/);
  const board = service.runtimeBoard("2026-07-29T01:00:03.000Z");
  assert.equal(board.repository.atomicClaims, true);
  assert.equal(board.repository.durableLeases, false);
  assert.equal(board.summary.runningJobs, 1);
  assert.equal(JSON.stringify(board).includes(claimed.leaseToken), false);
});

test("SQLite execution repository retains state across service restarts and serializes claims", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "digital-hospital-execution-"));
  const databaseFile = path.join(directory, "runtime.sqlite");
  const first = createDigitalHospitalExecutionService({
    repository: new SqliteExecutionRepository({
      databaseFile,
      seed: {
        environments: [{ id: "ENV-TEST", status: "healthy" }]
      }
    })
  });
  first.registerWorker({
    id: "WORKER-A",
    capabilities: ["probe"],
    now: "2026-07-29T02:00:00.000Z"
  });
  first.registerWorker({
    id: "WORKER-B",
    capabilities: ["probe"],
    now: "2026-07-29T02:00:00.000Z"
  });
  first.enqueue({
    id: "JOB-ONE",
    connectorId: "CONN-ONE",
    environmentId: "ENV-TEST",
    jobType: "probe",
    idempotencyKey: "sqlite-claim-one",
    payload: { batch: 1 },
    now: "2026-07-29T02:00:01.000Z"
  });
  const claimed = first.claim({
    workerId: "WORKER-A",
    now: "2026-07-29T02:00:02.000Z"
  }).result;
  assert.equal(first.claim({
    workerId: "WORKER-B",
    now: "2026-07-29T02:00:02.000Z"
  }).result, null);
  first.close();

  const second = createDigitalHospitalExecutionService({
    repository: new SqliteExecutionRepository({ databaseFile })
  });
  const board = second.runtimeBoard("2026-07-29T02:00:03.000Z");
  assert.equal(board.repository.storage, "sqlite-wal");
  assert.equal(board.repository.durableLeases, true);
  assert.equal(board.jobs.find((item) => item.id === "JOB-ONE").leaseOwner, "WORKER-A");
  assert.equal(JSON.stringify(board).includes(claimed.leaseToken), false);
  second.heartbeat("JOB-ONE", {
    workerId: "WORKER-A",
    leaseToken: claimed.leaseToken,
    now: "2026-07-29T02:00:10.000Z"
  });
  second.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test("execution persistence boundary rejects raw credentials payloads and security material", () => {
  assert.throws(
    () => assertExecutionPersistenceBoundary({ jobs: [{ rawPayload: { patient: "forbidden" } }] }),
    /cannot be persisted/
  );
  assert.throws(
    () => assertExecutionPersistenceBoundary({ workers: [{ token: "forbidden" }] }),
    /cannot be persisted/
  );
  assert.equal(assertExecutionPersistenceBoundary({
    jobs: [{ payloadDigest: "a".repeat(64), leaseTokenHash: "b".repeat(64) }],
    receipts: [{ nonceHash: "c".repeat(64), signatureStatus: "valid" }]
  }), true);
});
