"use strict";

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const test = require("node:test");
const sourceData = require("../data/db.json");
const {
  DEFAULT_INFECTIOUS_EVENT_LINK,
  applyInfectiousReportingAction,
  buildInfectiousReportingCaseFromSources
} = require("../public-health-event-reporting-service");
const {
  enqueueDirectReportDeliveryToState
} = require("../public-health-direct-report-outbox-service");
const {
  createPublicHealthDirectReportStateRepository
} = require("../public-health-direct-report-state-repository");
const {
  publicWorkerStatus,
  runWorkerOnce,
  workerConfiguration
} = require("../scripts/public-health-direct-report-worker");

const ROOT = path.resolve(__dirname, "..");

function queuedState() {
  const event = sourceData.publicHealthEvents.find(
    (item) => item.id === DEFAULT_INFECTIOUS_EVENT_LINK.publicHealthEventId
  );
  const report = sourceData.phase2DiseaseReportQueue.find(
    (item) => item.id === DEFAULT_INFECTIOUS_EVENT_LINK.reportId
  );
  let workflow = buildInfectiousReportingCaseFromSources({
    event,
    report,
    link: DEFAULT_INFECTIOUS_EVENT_LINK
  });
  const actor = { name: "commission reporter", role: "commission" };
  workflow = applyInfectiousReportingAction(workflow, {
    action: "validate-event",
    idempotencyKey: "cli:validate",
    at: "2026-08-05T08:00:00.000Z"
  }, actor).case;
  workflow = applyInfectiousReportingAction(workflow, {
    action: "create-report-card",
    idempotencyKey: "cli:card",
    at: "2026-08-05T08:01:00.000Z",
    reportCard: {
      sourceInstitutionCode: "210200001",
      testCode: "TB-PCR",
      resultFlag: "positive",
      occurredAt: "2026-08-05T07:30:00.000Z",
      reportedAt: "2026-08-05T08:01:00.000Z"
    }
  }, actor).case;
  workflow = applyInfectiousReportingAction(workflow, {
    action: "submit-report",
    idempotencyKey: "cli:submit",
    at: "2026-08-05T08:02:00.000Z"
  }, actor).case;
  return enqueueDirectReportDeliveryToState({
    publicHealthInfectiousReportingCases: [workflow]
  }, workflow, {
    at: "2026-08-05T08:02:00.000Z"
  }).nextData;
}

function repository(initial) {
  let state = structuredClone(initial);
  state.storageMeta = {
    engine: "sqlite",
    collectionVersions: {
      publicHealthInfectiousReportingCases: 1,
      publicHealthInfectiousReportingDeliveries: 1
    }
  };
  return createPublicHealthDirectReportStateRepository({
    readState: () => structuredClone(state),
    writeState(next) {
      const versions = state.storageMeta.collectionVersions;
      state = structuredClone(next);
      state.storageMeta = {
        engine: "sqlite",
        collectionVersions: {
          publicHealthInfectiousReportingCases:
            Number(versions.publicHealthInfectiousReportingCases) + 1,
          publicHealthInfectiousReportingDeliveries:
            Number(versions.publicHealthInfectiousReportingDeliveries) + 1
        }
      };
    }
  });
}

function workerEnv(overrides = {}) {
  return {
    NODE_ENV: "production",
    STORAGE_ENGINE: "sqlite",
    PUBLIC_HEALTH_DIRECT_REPORT_WORKER_ENABLED: "true",
    PUBLIC_HEALTH_DIRECT_REPORT_WORKER_ID: "public-health-worker-01",
    PUBLIC_HEALTH_DIRECT_REPORT_WORKER_BATCH_SIZE: "10",
    PUBLIC_HEALTH_DIRECT_REPORT_WORKER_LEASE_SECONDS: "120",
    PUBLIC_HEALTH_DIRECT_REPORT_URL: "https://cdc.example.gov.cn/direct-report",
    PUBLIC_HEALTH_DIRECT_REPORT_SECRET: "request-signing-secret-with-32-characters",
    PUBLIC_HEALTH_REFERENCE_SECRET: "reference-secret-with-at-least-32-characters",
    PUBLIC_HEALTH_DIRECT_REPORT_CALLBACK_SECRET: "callback-secret-with-at-least-32-characters",
    ...overrides
  };
}

test("worker CLI remains fail-closed and reports only configuration booleans", async () => {
  const disabled = await runWorkerOnce({ env: {} });
  assert.equal(disabled.skipped, true);
  assert.equal(disabled.status.productionReady, false);

  const status = publicWorkerStatus(workerEnv());
  assert.equal(status.codeReady, true);
  assert.equal(status.productionReady, false);
  assert.equal(status.blockers.some((item) => /official field dictionary/.test(item)), true);
  assert.doesNotMatch(JSON.stringify(status), /request-signing-secret|reference-secret|callback-secret/);
  assert.equal(workerConfiguration(workerEnv({
    PUBLIC_HEALTH_DIRECT_REPORT_WORKER_BATCH_SIZE: "500",
    PUBLIC_HEALTH_DIRECT_REPORT_WORKER_LEASE_SECONDS: "1"
  })).batchSize, 100);
});

test("worker CLI runs one transactional cycle without exposing request payload or secrets", async () => {
  const env = workerEnv();
  const result = await runWorkerOnce({
    env,
    dependencies: {
      repository: repository(queuedState()),
      dispatchOptions: {
        nowMs: Date.parse("2026-08-05T08:03:00.000Z")
      }
    },
    randomUUID: () => "cli-lease-token",
    clock: (() => {
      const values = [
        "2026-08-05T08:02:30.000Z",
        "2026-08-05T08:03:00.000Z",
        "2026-08-05T08:03:05.000Z",
        "2026-08-05T08:03:06.000Z"
      ];
      let index = 0;
      return () => values[Math.min(index++, values.length - 1)];
    })(),
    dispatch: async (request) => ({
      receiptId: "CLI-PROVIDER-RECEIPT-1",
      requestId: request.requestId,
      status: "accepted",
      acceptedAt: "2026-08-05T08:03:04.000Z",
      attempts: 1
    })
  });
  assert.equal(result.ok, true);
  assert.equal(result.processed, 1);
  assert.equal(result.awaitingCallback, 1);
  assert.equal(result.deliveries[0].state, "awaiting-callback");
  assert.doesNotMatch(
    JSON.stringify(result),
    /cli-lease-token|request-signing-secret|reference-secret|callback-secret|subjectReference|payload/
  );
});

test("systemd worker templates are least-privilege, timer-driven and disabled by default", () => {
  const service = fs.readFileSync(
    path.join(ROOT, "deploy", "public-health-direct-report-worker.service.template"),
    "utf8"
  );
  const timer = fs.readFileSync(
    path.join(ROOT, "deploy", "public-health-direct-report-worker.timer.template"),
    "utf8"
  );
  const env = fs.readFileSync(
    path.join(ROOT, "deploy", "public-health-direct-report-worker.env.template"),
    "utf8"
  );
  assert.match(service, /Type=oneshot/);
  assert.match(service, /NoNewPrivileges=true/);
  assert.match(service, /ProtectSystem=strict/);
  assert.match(service, /ReadWritePaths=__DATA_DIR__ __AUDIT_DIR__/);
  assert.match(timer, /OnUnitActiveSec=20s/);
  assert.match(timer, /Persistent=false/);
  assert.match(env, /STORAGE_ENGINE=sqlite/);
  assert.match(env, /PUBLIC_HEALTH_DIRECT_REPORT_WORKER_ENABLED=false/);
  assert.doesNotMatch(env, /[a-f0-9]{64}/);
});
