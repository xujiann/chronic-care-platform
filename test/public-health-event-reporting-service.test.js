const test = require("node:test");
const assert = require("node:assert/strict");
const data = require("../data/db.json");
const {
  DEFAULT_INFECTIOUS_EVENT_LINK,
  INFECTIOUS_REPORTING_STAGES,
  applyInfectiousReportingAction,
  buildInfectiousReportingCaseFromSources,
  runInfectiousReportingAcceptanceScenario,
  upsertInfectiousReportingCase
} = require("../public-health-event-reporting-service");

function buildInitialCase() {
  return buildInfectiousReportingCaseFromSources({
    event: data.publicHealthEvents.find((item) => item.id === DEFAULT_INFECTIOUS_EVENT_LINK.publicHealthEventId),
    report: data.phase2DiseaseReportQueue.find((item) => item.id === DEFAULT_INFECTIOUS_EVENT_LINK.reportId),
    receipt: data.phase2DiseaseReportReceipts.find((item) => item.reportId === DEFAULT_INFECTIOUS_EVENT_LINK.reportId)
  });
}

function apply(workflow, payload, user) {
  return applyInfectiousReportingAction(workflow, payload, user).case;
}

test("infectious event reporting closes discovery, card, receipt, CDC review and follow-up", () => {
  const closed = runInfectiousReportingAcceptanceScenario(buildInitialCase());

  assert.equal(closed.state, "followup-closed");
  assert.equal(closed.businessClosureComplete, true);
  assert.equal(closed.productionReady, false);
  assert.equal(closed.receipt.receiptStatus, "accepted");
  assert.match(closed.receipt.auditHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(closed.cdcReview.status, "confirmed");
  assert.equal(closed.followup.status, "closed");
  assert.equal(closed.standardMapping.status, "reviewed");
  assert.deepEqual(
    closed.timeline
      .filter((item) => item.action !== "review-standard-mapping")
      .map((item) => item.to)
      .filter((state) => INFECTIOUS_REPORTING_STAGES.includes(state)),
    INFECTIOUS_REPORTING_STAGES
  );
  assert.equal(closed.timeline.every((item) => item.actor && item.role && item.at), true);
  assert.equal(closed.publicHealthEventId, "phe-infectious-001");
  assert.equal(closed.reportId, "p2drq-inf-r3");
});

test("infectious event validation rejects missing source evidence fields", () => {
  const workflow = buildInitialCase();
  delete workflow.event.sampleNo;

  assert.throws(
    () => apply(workflow, { action: "validate-event", idempotencyKey: "missing-sample" }, { name: "医院报告员", role: "institution" }),
    /sampleNo/
  );
});

test("infectious event intake and submission are idempotent", () => {
  const initial = buildInitialCase();
  const firstIntake = upsertInfectiousReportingCase([], initial);
  const duplicateIntake = upsertInfectiousReportingCase(firstIntake.cases, initial);
  assert.equal(firstIntake.created, true);
  assert.equal(duplicateIntake.created, false);
  assert.equal(duplicateIntake.idempotent, true);
  assert.equal(duplicateIntake.cases.length, 1);

  const institution = { name: "医院报告员", role: "institution" };
  let workflow = apply(initial, { action: "validate-event", idempotencyKey: "idem-validate", at: "2026-07-08T08:35:00+08:00" }, institution);
  workflow = apply(workflow, { action: "create-report-card", idempotencyKey: "idem-card", at: "2026-07-08T08:40:00+08:00" }, institution);
  const submitted = applyInfectiousReportingAction(workflow, { action: "submit-report", idempotencyKey: "idem-submit", at: "2026-07-08T08:42:00+08:00" }, institution);
  const duplicate = applyInfectiousReportingAction(submitted.case, { action: "submit-report", idempotencyKey: "idem-submit", at: "2026-07-08T08:43:00+08:00" }, institution);

  assert.equal(duplicate.idempotent, true);
  assert.equal(duplicate.case.timeline.length, submitted.case.timeline.length);
  assert.equal(duplicate.case.reportCard.retryCount, 0);
  assert.throws(
    () => applyInfectiousReportingAction(submitted.case, { action: "submit-report", idempotencyKey: "idem-submit" }, { name: "居民", role: "citizen" }),
    /role citizen is not allowed/
  );
  assert.throws(
    () => applyInfectiousReportingAction(submitted.case, {
      action: "submit-report",
      idempotencyKey: "idem-submit",
      note: "changed command intent"
    }, institution),
    /idempotency conflict/
  );
  assert.throws(
    () => applyInfectiousReportingAction(submitted.case, {
      action: "submit-report",
      idempotencyKey: "idem-submit",
      at: "2026-07-08T08:44:00+08:00"
    }, { name: "another-commission-user", role: "commission" }),
    /idempotency conflict/
  );

  const drifted = structuredClone(initial);
  drifted.reportId = "another-report";
  assert.throws(
    () => upsertInfectiousReportingCase(firstIntake.cases, drifted),
    /reportId drift/
  );
});

test("report card patch is allowlisted and cannot rebind protected fields", () => {
  const institution = { name: "institution-reporter", role: "institution" };
  const validated = apply(
    buildInitialCase(),
    { action: "validate-event", idempotencyKey: "patch-validate" },
    institution
  );
  assert.throws(
    () => apply(validated, {
      action: "create-report-card",
      idempotencyKey: "patch-secret",
      reportCard: { signingSecret: "must-not-persist" }
    }, institution),
    /unsupported fields: signingSecret/
  );
  assert.throws(
    () => apply(validated, {
      action: "create-report-card",
      idempotencyKey: "patch-resident",
      reportCard: { residentId: "another-resident" }
    }, institution),
    /unsupported fields: residentId/
  );
});

test("rejected direct-report receipt opens an assigned exception and supports retry", () => {
  const institution = { name: "医院报告员", role: "institution" };
  const adapter = { name: "回执适配器", role: "system" };
  let workflow = buildInitialCase();
  workflow = apply(workflow, { action: "validate-event", idempotencyKey: "reject-validate" }, institution);
  workflow = apply(workflow, { action: "create-report-card", idempotencyKey: "reject-card" }, institution);
  workflow = apply(workflow, { action: "submit-report", idempotencyKey: "reject-submit-1" }, institution);
  workflow = apply(workflow, {
    action: "record-receipt",
    idempotencyKey: "reject-receipt-1",
    receiptStatus: "rejected",
    receiptCode: "CDC-REJECT-001",
    receivedAt: "2026-07-08T08:45:00+08:00",
    reason: "字段版本不匹配",
    exceptionOwner: "疾控直报接口专班",
    dueAt: "2026-07-08T10:45:00+08:00"
  }, adapter);

  assert.equal(workflow.state, "rejected");
  assert.equal(workflow.exception.status, "open");
  assert.equal(workflow.exception.owner, "疾控直报接口专班");
  assert.equal(workflow.exception.dueAt, "2026-07-08T10:45:00+08:00");

  workflow = apply(workflow, { action: "submit-report", idempotencyKey: "reject-submit-2", note: "按正式字段版本补偿重试" }, institution);
  assert.equal(workflow.state, "submitted");
  assert.equal(workflow.exception.status, "retry-submitted");
  assert.equal(workflow.reportCard.retryCount, 1);
});

test("infectious reporting enforces human role and transition boundaries", () => {
  const initial = buildInitialCase();
  assert.throws(
    () => apply(initial, { action: "validate-event", idempotencyKey: "citizen-validate" }, { name: "居民", role: "citizen" }),
    /role citizen is not allowed/
  );
  assert.throws(
    () => apply(initial, { action: "create-report-card", idempotencyKey: "early-card" }, { name: "医院报告员", role: "institution" }),
    /not allowed from state detected/
  );
  assert.throws(
    () => apply(initial, { action: "record-receipt", idempotencyKey: "early-receipt", receiptStatus: "accepted" }, { name: "适配器", role: "system" }),
    /not allowed from state detected/
  );
  assert.throws(
    () => apply(initial, { action: "validate-event", idempotencyKey: "stale-version", expectedVersion: 0 }, { name: "医院报告员", role: "institution" }),
    /version conflict: expected 0, current 1/
  );
});

test("follow-up closure is blocked until standard mapping evidence is reviewed", () => {
  const institution = { name: "医院报告员", role: "institution" };
  const cdc = { name: "疾控复核员", role: "cdc" };
  const adapter = { name: "回执适配器", role: "system" };
  let workflow = buildInitialCase();
  workflow = apply(workflow, { action: "validate-event", idempotencyKey: "map-validate" }, institution);
  workflow = apply(workflow, { action: "create-report-card", idempotencyKey: "map-card" }, institution);
  workflow = apply(workflow, { action: "submit-report", idempotencyKey: "map-submit" }, institution);
  workflow = apply(workflow, { action: "record-receipt", idempotencyKey: "map-receipt", receiptStatus: "accepted", receiptCode: "CDC-OK-001", receivedAt: "2026-07-08T09:00:00+08:00" }, adapter);
  workflow = apply(workflow, { action: "review-by-cdc", idempotencyKey: "map-review", note: "病例复核完成" }, cdc);

  assert.throws(
    () => apply(workflow, { action: "close-followup", idempotencyKey: "map-close", followupConclusion: "流调完成", evidenceRefs: ["investigation-1"] }, cdc),
    /standard mapping must be reviewed/
  );
});
