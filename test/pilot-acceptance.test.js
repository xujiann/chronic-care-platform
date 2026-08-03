const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { applyPilotInterfaceReviewAction, buildPilotAcceptanceCenter } = require("../pilot-acceptance");
const { parseArgs, renderMarkdown, writeOutput } = require("../scripts/pilot-acceptance-readiness");

const ROOT = path.resolve(__dirname, "..");

test("pilot acceptance center covers all planned development tracks", () => {
  const center = buildPilotAcceptanceCenter({ env: {} });
  assert.equal(center.ok, true);
  assert.equal(center.functionalState, "pilot-acceptance-tooling-ready");
  assert.equal(center.formalGoLiveState, "blocked-until-site-evidence-signed");
  assert.equal(center.applications.length, 8);
  assert.equal(center.applications.every((item) => item.status === "regression-ready"), true);
  assert.equal(center.alerting.contractReady, true);
  assert.equal(center.alerting.adapterReady, false);
  assert.equal(center.alerting.drillReceiptRecorded, false);
  assert.equal(center.summary.alertDrillReceipts, 0);
  assert.equal(center.onsiteTasks.length, 10);
  assert.equal(center.onsiteTasks.every((item) => item.owner && item.targetWindow && item.evidence && item.doneWhen), true);
  assert.deepEqual(center.interfaceSamples.map((item) => item.id), ["official-grouper", "insurance-core", "his-emr-feed", "physical-exam-feed"]);
  assert.equal(center.interfaceSamples.every((item) => !item.containsPatientData && item.idempotencyKey && item.retryPolicy), true);
  assert.equal(center.trialRun.scenarios.length, 7);
  assert.equal(center.trialRun.scenarios.every((item) => item.passed && item.mode === "synthetic-no-patient-data"), true);
  assert.equal(center.issues.some((item) => item.id === "PILOT-ISSUE-ALERTING"), true);
  assert.match(center.boundary, /does not configure a real receiver/);
});

test("pilot alerting preflight recognizes a configured HTTPS route without claiming production signoff", () => {
  const center = buildPilotAcceptanceCenter({
    env: {
      NODE_ENV: "production",
      SIEM_ENDPOINT: "https://siem.example.invalid/alerts",
      SIEM_SIGNING_SECRET: "a-strong-synthetic-secret-with-32-characters",
      CUTOVER_MONITORING_SIGNOFF: "false"
    }
  });
  assert.equal(center.alerting.adapterReady, true);
  assert.equal(center.alerting.routes.find((item) => item.route === "SIEM").status, "configured");
  assert.equal(center.alerting.drillReceiptRecorded, false);
  assert.equal(center.alerting.signoffRecorded, false);
  assert.equal(center.formalGoLiveState, "blocked-until-site-evidence-signed");
  assert.match(center.issues.find((item) => item.id === "PILOT-ISSUE-ALERTING").title, /演练回执/);
});

test("pilot interface joint-test requires four results and an independent reviewer", () => {
  const initial = {};
  const failed = applyPilotInterfaceReviewAction(initial, "official-grouper", {
    action: "record-joint-test",
    executionId: "JT-FAILED-001",
    evidenceRef: "receipt:failed-001",
    note: "Retry scenario failed and must be corrected.",
    results: { success: true, failure: true, retry: false, reconciliation: true }
  }, { name: "登记人", role: "commission" }, new Date("2026-07-21T01:00:00.000Z"));
  assert.equal(failed.item.workflowStatus, "joint-test-failed");
  assert.throws(() => applyPilotInterfaceReviewAction({ pilotAcceptanceInterfaceReviews: failed.reviews }, "official-grouper", {
    action: "review-joint-test",
    note: "Must not pass."
  }, { name: "复核人", role: "commission" }), /must pass all four scenarios/);

  const recorded = applyPilotInterfaceReviewAction({ pilotAcceptanceInterfaceReviews: failed.reviews }, "official-grouper", {
    action: "record-joint-test",
    executionId: "JT-PASS-002",
    evidenceRef: "receipt:pass-002",
    note: "All four scenarios passed.",
    results: { success: true, failure: true, retry: true, reconciliation: true }
  }, { name: "登记人", role: "commission" }, new Date("2026-07-21T02:00:00.000Z"));
  assert.equal(recorded.item.workflowStatus, "evidence-recorded");
  assert.throws(() => applyPilotInterfaceReviewAction({ pilotAcceptanceInterfaceReviews: recorded.reviews }, "official-grouper", {
    action: "review-joint-test",
    note: "Self review must fail."
  }, { name: "登记人", role: "commission" }), /independent/);

  const reviewed = applyPilotInterfaceReviewAction({ pilotAcceptanceInterfaceReviews: recorded.reviews }, "official-grouper", {
    action: "review-joint-test",
    note: "Receipt and all four scenario results independently verified."
  }, { name: "复核人", role: "commission" }, new Date("2026-07-21T03:00:00.000Z"));
  assert.equal(reviewed.item.workflowStatus, "site-reviewed");
  assert.equal(reviewed.item.reviewedBy, "复核人");
  const center = buildPilotAcceptanceCenter({ data: { ...require("../data/db.json"), pilotAcceptanceInterfaceReviews: reviewed.reviews }, env: {} });
  assert.equal(center.summary.interfaceReviewed, 1);
  assert.equal(center.issues.find((item) => item.id === "PILOT-ISSUE-INT-01").status, "resolved");

  const revoked = applyPilotInterfaceReviewAction({ pilotAcceptanceInterfaceReviews: reviewed.reviews }, "official-grouper", {
    action: "revoke-joint-test",
    note: "Receiver configuration changed."
  }, { name: "复核人", role: "commission" }, new Date("2026-07-21T04:00:00.000Z"));
  assert.equal(revoked.item.workflowStatus, "revoked");
});

test("pilot center can reach formal go-no-go only when all external reviews are present", () => {
  const data = {
    ...require("../data/db.json"),
    platformProductionBlockerReviews: Array.from({ length: 10 }, (_, index) => ({
      blockerId: `P0-${String(index + 1).padStart(2, "0")}`,
      workflowStatus: "site-accepted",
      siteAcceptance: { status: "accepted", evidenceRef: `site-evidence-${index + 1}`, acceptedBy: "现场验收组" }
    })),
    pilotAcceptanceInterfaceReviews: ["official-grouper", "insurance-core", "his-emr-feed", "physical-exam-feed"].map((interfaceId, index) => ({
      interfaceId,
      workflowStatus: "site-reviewed",
      executionId: `joint-test-${index + 1}`,
      evidenceRef: `joint-test-receipt-${index + 1}`,
      results: { success: true, failure: true, retry: true, reconciliation: true },
      recordedBy: "联调登记人",
      reviewedBy: "独立复核人"
    })),
    observabilityAlertDeliveries: [{
      id: "alert-drill-001",
      route: "SIEM",
      status: "accepted",
      deadLetter: false,
      deliveredAt: "2026-07-21T05:00:00.000Z",
      alert: { labels: { environment: "production" } },
      adapterReceipt: { receiptId: "SIEM-RECEIPT-001", acceptedAt: "2026-07-21T05:00:00.000Z" }
    }]
  };
  const center = buildPilotAcceptanceCenter({
    data,
    env: {
      NODE_ENV: "production",
      SIEM_ENDPOINT: "https://siem.example.invalid/alerts",
      SIEM_SIGNING_SECRET: "a-strong-synthetic-secret-with-32-characters",
      CUTOVER_MONITORING_SIGNOFF: "true"
    }
  });
  assert.equal(center.summary.onsiteAccepted, 10);
  assert.equal(center.summary.interfaceReviewed, 4);
  assert.equal(center.summary.alertDrillReceipts, 1);
  assert.equal(center.alerting.acceptanceReady, true);
  assert.equal(center.summary.openIssues, 0);
  assert.equal(center.formalGoLiveState, "ready-for-formal-go-no-go");
});

test("pilot acceptance readiness renders and writes release artifacts", (t) => {
  const outputDir = path.join(ROOT, "tmp", "pilot-acceptance-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const center = buildPilotAcceptanceCenter({ env: {} });
  const markdown = renderMarkdown(center);
  assert.match(markdown, /Eight-application regression matrix/);
  assert.match(markdown, /P0 on-site acceptance task pack/);
  assert.match(markdown, /synthetic identifiers and contain no patient data/);
  assert.match(markdown, /Issue ledger/);

  writeOutput(center, {
    output: path.join("tmp", "pilot-acceptance-test", "pilot-acceptance.json"),
    markdown: path.join("tmp", "pilot-acceptance-test", "pilot-acceptance.md")
  });
  assert.equal(JSON.parse(fs.readFileSync(path.join(outputDir, "pilot-acceptance.json"), "utf8")).summary.applications, 8);
  assert.match(fs.readFileSync(path.join(outputDir, "pilot-acceptance.md"), "utf8"), /blocked-until-site-evidence-signed/);
});

test("pilot acceptance CLI parser keeps output and environment flags", () => {
  assert.deepEqual(parseArgs(["--output=tmp/report.json", "--markdown=tmp/report.md", "--config-env=.env.pilot"]), {
    output: "tmp/report.json",
    markdown: "tmp/report.md",
    envFile: ".env.pilot"
  });
});
