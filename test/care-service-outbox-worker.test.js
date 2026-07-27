const test = require("node:test");
const assert = require("node:assert/strict");

const NursingService = require("../internet-nursing-service");
const Worker = require("../scripts/care-service-outbox-worker");

const AT = "2026-07-23T01:00:00.000Z";

function repositoryWithEvent() {
  const event = NursingService.buildOutboxEvent({
    aggregateId: "ino-worker-001",
    eventType: "internet-nursing-order-created",
    occurredAt: AT,
    idempotencyKey: "nursing:ino-worker-001:create",
    payload: { orderId: "ino-worker-001" }
  });
  let state = { internetNursingOutbox: [event], escortServiceOutbox: [] };
  let version = 1;
  return {
    current: () => structuredClone(state),
    async transaction(callback) {
      let staged = structuredClone(state);
      let stagedVersion = version;
      const result = await callback({
        async readState() {
          return { state: structuredClone(staged), version: stagedVersion };
        },
        async writeState(next, options = {}) {
          if (options.expectedVersion !== stagedVersion) throw new Error("version conflict");
          staged = structuredClone(next);
          stagedVersion += 1;
          return { version: stagedVersion };
        }
      });
      state = staged;
      version = stagedVersion;
      return result;
    }
  };
}

test("worker is explicitly disabled by default", async () => {
  const result = await Worker.runWorkerOnce({ env: {} });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.match(result.reason, /not enabled/);
});

test("enabled worker refuses to run without stable identity or runtime module", async () => {
  await assert.rejects(
    () => Worker.runWorkerOnce({ env: { CARE_OUTBOX_WORKER_ENABLED: "true" } }),
    (error) => error.code === "CARE_WORKER_ID_REQUIRED"
  );
  await assert.rejects(
    () => Worker.runWorkerOnce({
      env: {
        CARE_OUTBOX_WORKER_ENABLED: "true",
        CARE_OUTBOX_WORKER_ID: "worker-001"
      }
    }),
    (error) => error.code === "CARE_WORKER_RUNTIME_MODULE_REQUIRED"
  );
});

test("worker executes one safe transactional delivery cycle", async () => {
  const repository = repositoryWithEvent();
  const result = await Worker.runWorkerOnce({
    env: {
      CARE_OUTBOX_WORKER_ENABLED: "true",
      CARE_OUTBOX_WORKER_ID: "worker-001",
      CARE_OUTBOX_BATCH_SIZE: "10"
    },
    dependencies: {
      repository,
      deliveryAdapters: {
        nursing: async (event, context) => ({
          status: "accepted",
          providerMessageId: `${context.workerId}:${event.aggregateId}`
        })
      }
    },
    runId: "run-worker-001",
    at: "2026-07-23T01:00:02.000Z"
  });
  assert.equal(result.ok, true);
  assert.equal(result.claimed, 1);
  assert.equal(result.delivered, 1);
  assert.equal(result.resultCodes[0].status, "delivered");
  assert.equal(repository.current().internetNursingOutbox[0].status, "delivered");
});
