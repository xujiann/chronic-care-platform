const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const sourceData = require("../data/db.json");
const {
  DEFAULT_INFECTIOUS_EVENT_LINK,
  buildInfectiousReportingCaseFromSources
} = require("../public-health-event-reporting-service");
const {
  PRIORITY_STANDARD_REVIEW_TRACKS,
  buildPriorityStandardReviewPack
} = require("../public-health-priority-standard-review-service");
const { buildPublicHealthCoordinationCenter } = require("../public-health-coordination-service");
const {
  applyPublicHealthCoordinationActionToState,
  buildPublicHealthCoordinationRuntime
} = require("../public-health-coordination-runtime");

const ROOT = path.resolve(__dirname, "..");

function buildDependencies(data = sourceData) {
  const eventReporting = buildInfectiousReportingCaseFromSources({
    event: data.publicHealthEvents.find((item) => item.id === DEFAULT_INFECTIOUS_EVENT_LINK.publicHealthEventId),
    report: data.phase2DiseaseReportQueue.find((item) => item.id === DEFAULT_INFECTIOUS_EVENT_LINK.reportId),
    receipt: data.phase2DiseaseReportReceipts.find((item) => item.reportId === DEFAULT_INFECTIOUS_EVENT_LINK.reportId)
  });
  const artifactAvailability = Object.fromEntries(
    PRIORITY_STANDARD_REVIEW_TRACKS.flatMap((track) => track.artifactEvidence)
      .map((file) => [file, fs.existsSync(path.join(ROOT, file))])
  );
  const standardReview = buildPriorityStandardReviewPack({
    ledger: data.publicHealthStandardImplementationLedger,
    data,
    artifactAvailability
  });
  const center = buildPublicHealthCoordinationCenter({ data, eventReporting, standardReview });
  return { eventReporting, standardReview, center };
}

test("coordination runtime persists action state and a minimized append-only audit", () => {
  const data = JSON.parse(JSON.stringify(sourceData));
  const dependencies = buildDependencies(data);
  const initial = dependencies.center.handoffs.find((item) => item.laneId === "maternal-child");
  const result = applyPublicHealthCoordinationActionToState(data, initial.id, {
    action: "assign-coordination",
    idempotencyKey: "runtime:mch:assign",
    expectedVersion: 1,
    assignedTo: "妇幼健康责任人",
    dueAt: "2026-07-31",
    note: "确认责任人和时限"
  }, { name: "妇幼管理员", role: "maternal-child" }, dependencies);

  assert.equal(result.handoff.state, "assigned");
  assert.equal(result.handoff.version, 2);
  assert.equal(result.nextData.publicHealthCoordinationHandoffs.length, 8);
  assert.equal(result.nextData.publicHealthCoordinationAudit.length, 1);
  assert.equal(Object.hasOwn(result.nextData.publicHealthCoordinationAudit[0], "residentId"), false);
  assert.equal(JSON.stringify(data).includes("runtime:mch:assign"), false);
  assert.equal(result.productionReady, false);
});

test("coordination runtime restores persisted state without accepting invariant tampering", () => {
  const data = JSON.parse(JSON.stringify(sourceData));
  const dependencies = buildDependencies(data);
  const first = dependencies.center.handoffs[0];
  data.publicHealthCoordinationHandoffs = [{
    ...first,
    version: 5,
    state: "assigned",
    assignedTo: "已落库责任人",
    laneId: "tampered-lane",
    sourceRefs: ["forged-source"]
  }];
  let runtime = buildPublicHealthCoordinationRuntime({ data, ...dependencies });
  assert.equal(runtime.handoffs[0].state, "detected");
  assert.deepEqual(runtime.handoffs[0].sourceRefs, first.sourceRefs);
  assert.equal(runtime.summary.rejectedPersistedHandoffs, 1);

  data.publicHealthCoordinationHandoffs[0] = {
    ...first,
    version: 5,
    state: "assigned",
    assignedTo: "已落库责任人",
    dueAt: "2026-07-31",
    sourceRefs: ["forged-source"]
  };
  runtime = buildPublicHealthCoordinationRuntime({ data, ...dependencies });
  assert.equal(runtime.handoffs[0].state, "assigned");
  assert.equal(runtime.handoffs[0].assignedTo, "已落库责任人");
  assert.deepEqual(runtime.handoffs[0].sourceRefs, first.sourceRefs);
});

test("coordination runtime keeps replay idempotent and enforces optimistic versions", () => {
  const data = JSON.parse(JSON.stringify(sourceData));
  const dependencies = buildDependencies(data);
  const initial = dependencies.center.handoffs.find((item) => item.laneId === "senior-health");
  const payload = {
    action: "assign-coordination",
    idempotencyKey: "runtime:senior:assign",
    expectedVersion: 1,
    assignedTo: "老年健康责任人",
    dueAt: "2026-07-31",
    note: "确认老年健康任务"
  };
  const first = applyPublicHealthCoordinationActionToState(
    data,
    initial.id,
    payload,
    { name: "基层管理员", role: "primary-care" },
    dependencies
  );
  const replay = applyPublicHealthCoordinationActionToState(
    first.nextData,
    initial.id,
    payload,
    { name: "基层管理员", role: "primary-care" },
    dependencies
  );
  assert.equal(replay.idempotent, true);
  assert.equal(replay.handoff.version, 2);
  assert.equal(replay.nextData.publicHealthCoordinationAudit.length, 1);
  assert.throws(() => applyPublicHealthCoordinationActionToState(
    first.nextData,
    initial.id,
    {
      action: "start-coordination",
      idempotencyKey: "runtime:senior:stale",
      expectedVersion: 1,
      note: "使用过期版本接单"
    },
    { name: "基层管理员", role: "primary-care" },
    dependencies
  ), /version conflict/);
});

test("coordination runtime rejects unknown handoffs", () => {
  assert.throws(() => applyPublicHealthCoordinationActionToState(
    sourceData,
    "phc-unknown-001",
    { action: "assign-coordination", idempotencyKey: "unknown" },
    { name: "管理员", role: "commission" },
    buildDependencies(sourceData)
  ), /unknown public health coordination handoff/);
});

test("coordination runtime rejects forged or internally inconsistent operational states", () => {
  const data = JSON.parse(JSON.stringify(sourceData));
  const dependencies = buildDependencies(data);
  const initial = dependencies.center.handoffs.find((item) => item.laneId === "chronic-management");
  data.publicHealthCoordinationHandoffs = [{
    ...initial,
    version: 99,
    state: "closed",
    businessClosureComplete: true,
    closure: null
  }];
  const runtime = buildPublicHealthCoordinationRuntime({ data, ...dependencies });
  const restored = runtime.handoffs.find((item) => item.id === initial.id);
  assert.equal(restored.state, "detected");
  assert.equal(restored.version, 1);
  assert.equal(runtime.summary.rejectedPersistedHandoffs, 1);
  assert.equal(runtime.productionReady, false);
});
