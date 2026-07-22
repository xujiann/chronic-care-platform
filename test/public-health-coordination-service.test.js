const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const data = require("../data/db.json");
const {
  DEFAULT_INFECTIOUS_EVENT_LINK,
  buildInfectiousReportingCaseFromSources
} = require("../public-health-event-reporting-service");
const {
  PRIORITY_STANDARD_REVIEW_TRACKS,
  buildPriorityStandardReviewPack
} = require("../public-health-priority-standard-review-service");
const {
  COORDINATION_LANES,
  applyPublicHealthCoordinationAction,
  buildPublicHealthCoordinationCenter,
  runPublicHealthCoordinationAcceptanceScenario
} = require("../public-health-coordination-service");

const ROOT = path.resolve(__dirname, "..");

function buildCenter(sourceData = data) {
  const eventReporting = buildInfectiousReportingCaseFromSources({
    event: sourceData.publicHealthEvents.find((item) => item.id === DEFAULT_INFECTIOUS_EVENT_LINK.publicHealthEventId),
    report: sourceData.phase2DiseaseReportQueue.find((item) => item.id === DEFAULT_INFECTIOUS_EVENT_LINK.reportId),
    receipt: sourceData.phase2DiseaseReportReceipts.find((item) => item.reportId === DEFAULT_INFECTIOUS_EVENT_LINK.reportId)
  });
  const artifacts = Object.fromEntries(
    PRIORITY_STANDARD_REVIEW_TRACKS.flatMap((track) => track.artifactEvidence).map((file) => [file, fs.existsSync(path.join(ROOT, file))])
  );
  const standardReview = buildPriorityStandardReviewPack({
    ledger: sourceData.publicHealthStandardImplementationLedger,
    data: sourceData,
    artifactAvailability: artifacts
  });
  return buildPublicHealthCoordinationCenter({ data: sourceData, eventReporting, standardReview });
}

function advanceToInProgress(initial) {
  const owner = { name: "责任人", role: initial.ownerRole };
  let handoff = applyPublicHealthCoordinationAction(initial, {
    action: "assign-coordination",
    idempotencyKey: `${initial.id}:test-assign`,
    assignedTo: initial.owner,
    dueAt: "2026-07-25",
    note: "确认责任和时限"
  }, owner).handoff;
  handoff = applyPublicHealthCoordinationAction(handoff, {
    action: "start-coordination",
    idempotencyKey: `${initial.id}:test-start`,
    note: "开始跨域协同"
  }, owner).handoff;
  return handoff;
}

test("public health coordination center exposes all eight accountable lanes", () => {
  const center = buildCenter();

  assert.equal(center.ok, true);
  assert.equal(center.functionalState, "eight-lane-coordination-runnable");
  assert.equal(center.formalGoLiveState, "blocked-until-external-receipts-and-site-evidence-verified");
  assert.equal(center.summary.lanes, 8);
  assert.equal(center.summary.structurallyReady, 8);
  assert.equal(center.summary.handoffs, 8);
  assert.equal(center.summary.eventReportingLinked, true);
  assert.equal(center.summary.standardReviewTracks, 8);
  assert.deepEqual(center.lanes.map((item) => item.id), COORDINATION_LANES.map((item) => item.id));
  assert.equal(center.handoffs.every((item) => item.businessKey && item.sourceRefs.length && item.standardDomainIds.length), true);
  assert.equal(center.handoffs.every((item) => item.owner && item.ownerRole && item.collaborators.length), true);
});

test("eight-lane acceptance scenario closes each business handoff with audit evidence", () => {
  const completed = runPublicHealthCoordinationAcceptanceScenario(buildCenter());

  assert.equal(completed.functionalState, "eight-lane-business-closure-runnable");
  assert.equal(completed.summary.closedHandoffs, 8);
  assert.equal(completed.summary.openHandoffs, 0);
  assert.equal(completed.summary.auditEntries, 32);
  assert.equal(completed.productionReady, false);
  assert.equal(completed.handoffs.every((item) => item.state === "closed" && item.businessClosureComplete), true);
  assert.equal(completed.handoffs.every((item) => item.timeline.length === 4 && item.closure.evidenceRefs.length === item.requiredEvidence.length), true);
});

test("rejected coordination receipt opens an assigned exception and can be retried", () => {
  const initial = buildCenter().handoffs.find((item) => item.laneId === "immunization");
  const owner = { name: "免疫规划责任人", role: initial.ownerRole };
  const adapter = { name: "免疫回执适配器", role: "system" };
  let handoff = advanceToInProgress(initial);
  handoff = applyPublicHealthCoordinationAction(handoff, {
    action: "record-coordination-receipt",
    idempotencyKey: "immunization-rejected-receipt",
    receiptStatus: "rejected",
    receiptCode: "IMM-REJECT-001",
    evidenceRefs: ["registry-reject-payload"],
    reason: "儿童接种档案字段版本不匹配",
    exceptionOwner: "疾控免疫规划接口专班",
    dueAt: "2026-07-25"
  }, adapter).handoff;

  assert.equal(handoff.state, "exception-open");
  assert.equal(handoff.exception.status, "open");
  assert.equal(handoff.exception.owner, "疾控免疫规划接口专班");
  handoff = applyPublicHealthCoordinationAction(handoff, {
    action: "retry-coordination",
    idempotencyKey: "immunization-retry",
    note: "修正字段版本后重新提交"
  }, owner).handoff;
  assert.equal(handoff.state, "in-progress");
  assert.equal(handoff.exception.status, "retry-submitted");
});

test("coordination closure requires the complete lane evidence set", () => {
  const initial = buildCenter().handoffs.find((item) => item.laneId === "family-doctor");
  const owner = { name: "家庭医生责任人", role: initial.ownerRole };
  const adapter = { name: "家医回执适配器", role: "system" };
  let handoff = advanceToInProgress(initial);
  handoff = applyPublicHealthCoordinationAction(handoff, {
    action: "record-coordination-receipt",
    idempotencyKey: "family-receipt",
    receiptStatus: "accepted",
    receiptCode: "FD-ACCEPT-001",
    evidenceRefs: ["family-doctor-contract-receipt"]
  }, adapter).handoff;

  assert.throws(
    () => applyPublicHealthCoordinationAction(handoff, {
      action: "close-coordination",
      idempotencyKey: "family-close-incomplete",
      conclusion: "尝试关闭",
      evidenceRefs: ["application-review"]
    }, owner),
    /closure evidenceRefs must exactly match requiredEvidence/
  );
});

test("coordination actions enforce lane roles, versions and authorized idempotent replay", () => {
  const initial = buildCenter().handoffs.find((item) => item.laneId === "maternal-child");
  const payload = {
    action: "assign-coordination",
    idempotencyKey: "maternal-assign",
    assignedTo: initial.owner,
    dueAt: "2026-07-25",
    note: "确认妇幼责任人"
  };
  assert.throws(
    () => applyPublicHealthCoordinationAction(initial, payload, { name: "基层人员", role: "primary-care" }),
    /role primary-care is not allowed/
  );
  assert.throws(
    () => applyPublicHealthCoordinationAction(initial, { ...payload, expectedVersion: 0 }, { name: "妇幼责任人", role: "maternal-child" }),
    /version conflict/
  );

  const first = applyPublicHealthCoordinationAction(initial, payload, { name: "妇幼责任人", role: "maternal-child" });
  const duplicate = applyPublicHealthCoordinationAction(first.handoff, payload, { name: "妇幼责任人", role: "maternal-child" });
  assert.equal(duplicate.idempotent, true);
  assert.equal(duplicate.handoff.timeline.length, first.handoff.timeline.length);
  assert.throws(
    () => applyPublicHealthCoordinationAction(first.handoff, payload, { name: "居民", role: "citizen" }),
    /role citizen is not allowed/
  );
});

test("coordination center exposes missing source collections instead of claiming readiness", () => {
  const incomplete = JSON.parse(JSON.stringify(data));
  incomplete.chronicEducationPushes = [];
  const center = buildCenter(incomplete);
  const education = center.lanes.find((item) => item.id === "health-education");

  assert.equal(center.ok, false);
  assert.equal(education.structurallyReady, false);
  assert.deepEqual(education.missingCollections, ["chronicEducationPushes"]);
});
