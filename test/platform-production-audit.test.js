const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  buildPlatformProductionAudit,
  parseArgs,
  renderMarkdown,
  writeOutput
} = require("../scripts/platform-production-audit");
const {
  applyPlatformCapabilityReviewAction,
  applyPlatformProductionBlockerAction,
  buildPlatformCapabilityOperationsCenter,
  seedPlatformCapabilityReviews,
  seedPlatformProductionBlockerReviews
} = require("../platform-capability-operations");

const ROOT = path.resolve(__dirname, "..");

test("platform production audit separates implemented capabilities from production readiness", () => {
  const document = ["审计结论", "正式生产前已实现的主要功能", "生产割接差距", "下一步开发规划", "正式上线退出条件"].join("\n");
  const report = buildPlatformProductionAudit({
    document,
    cutoverRows: Array.from({ length: 10 }, (_, index) => ({ id: `cutover-${index + 1}`, passed: index === 0 }))
  });

  assert.equal(report.ok, true);
  assert.equal(report.productionReady, false);
  assert.equal(report.summary.capabilityDomains, 10);
  assert.equal(report.summary.implementedDomains, 10);
  assert.equal(report.summary.productionReadyDomains, 0);
  assert.equal(report.summary.productionBlockers, 10);
  assert.equal(report.summary.mvpRequiredModules, 8);
  assert.equal(report.summary.capabilityOperationsCenter, true);
  assert.equal(report.summary.productionDatabaseAdapter, true);
  assert.equal(report.summary.cutoverPassed, 1);
  assert.equal(report.summary.cutoverBlocked, 9);
  assert.equal(report.capabilities.every((item) => item.evidenceReady && item.boundary), true);
  assert.equal(report.productionBlockers.every((item) => item.owner && item.evidence && item.doneWhen), true);
  assert.equal(report.productionBlockers.find((item) => item.id === "P0-01").status, "automation-foundation-ready-site-acceptance-pending");
  assert.match(report.productionBlockers.find((item) => item.id === "P0-01").progress, /不可变部署包/);
  assert.equal(report.productionBlockers.find((item) => item.id === "P0-02").status, "primary-read-production-adapter-ready-site-acceptance-pending");
  assert.match(report.productionBlockers.find((item) => item.id === "P0-02").progress, /SERIALIZABLE 主写/);
  assert.equal(report.productionBlockers.find((item) => item.id === "P0-03").status, "adapter-foundation-ready-site-joint-test-pending");
  assert.equal(report.productionBlockers.find((item) => item.id === "P0-04").status, "adapter-foundation-ready-site-joint-test-pending");
  assert.equal(report.productionBlockers.find((item) => item.id === "P0-05").status, "adapter-foundation-ready-site-joint-test-pending");
  assert.equal(report.productionBlockers.find((item) => item.id === "P0-06").status, "adapter-foundation-ready-site-joint-test-pending");
  assert.match(report.productionBlockers.find((item) => item.id === "P0-06").progress, /14 个受控操作/);
  assert.equal(report.productionBlockers.find((item) => item.id === "P0-08").status, "adapter-foundation-ready-site-joint-test-pending");
  assert.equal(report.productionBlockers.find((item) => item.id === "P0-09").status, "adapter-foundation-ready-site-joint-test-pending");
  assert.match(report.productionBlockers.find((item) => item.id === "P0-09").progress, /失败运维事件/);
  assert.equal(report.mvpRequiredModules.find((item) => item.id === "mvp-identity-message").status, "adapter-foundation-ready");
  assert.equal(report.mvpRequiredModules.find((item) => item.id === "mvp-hospital-connectors").status, "adapter-foundation-ready");
  assert.equal(report.mvpRequiredModules.find((item) => item.id === "mvp-payment-insurance").status, "adapter-foundation-ready");
  assert.equal(report.mvpRequiredModules.find((item) => item.id === "mvp-object-storage").status, "adapter-foundation-ready");
  assert.equal(report.mvpRequiredModules.find((item) => item.id === "mvp-observability-audit").status, "adapter-foundation-ready");
  assert.equal(report.mvpRequiredModules.find((item) => item.id === "mvp-secrets-deployment").status, "automation-foundation-ready");
  assert.equal(report.mvpRequiredModules.find((item) => item.id === "mvp-production-database").status, "primary-read-production-adapter-ready-site-acceptance-pending");
  assert.equal(report.mvpRequiredModules.every((item) => item.remainingCode && item.siteDependency), true);
  assert.deepEqual(report.roadmap.map((item) => item.phase), ["P0 / 0-30 天", "P1 / 31-60 天", "P2 / 61-90 天", "持续优化 / 90 天后"]);
  assert.equal(report.checks.find((item) => item.id === "platformAudit:capabilityOperationsCenter").passed, true);
  assert.equal(report.checks.find((item) => item.id === "platformAudit:productionDatabaseAdapter").passed, true);
});

test("platform capability operations center keeps evidence-backed reviews pre-production only", () => {
  const data = { platformCapabilityReviews: seedPlatformCapabilityReviews() };
  const initial = buildPlatformCapabilityOperationsCenter(data, { evidenceExists: () => true });
  assert.equal(initial.summary.capabilityDomains, 10);
  assert.equal(initial.summary.pendingReview, 10);
  assert.equal(initial.summary.productionReady, 0);

  assert.throws(
    () => applyPlatformCapabilityReviewAction(data, "data-governance", {
      action: "review",
      note: "Review attempted without evidence."
    }, { name: "Audit User", role: "commission" }),
    (error) => error.code === "PLATFORM_CAPABILITY_REVIEW_EVIDENCE_REQUIRED" && error.statusCode === 409
  );

  const evidence = applyPlatformCapabilityReviewAction(data, "data-governance", {
    action: "record-evidence",
    evidenceRef: "release:data-governance-readiness",
    note: "Readiness evidence has been registered."
  }, { name: "Audit User", role: "commission" });
  const reviewed = applyPlatformCapabilityReviewAction({ platformCapabilityReviews: evidence.reviews }, "data-governance", {
    action: "review",
    note: "Repository capability and current production boundary were reviewed."
  }, { name: "Audit User", role: "commission" });
  assert.equal(reviewed.item.reviewStatus, "reviewed-preproduction");
  assert.equal(reviewed.item.productionReady, false);
  assert.equal(reviewed.item.evidenceRefs.length, 1);
  assert.equal(reviewed.item.actionHistory.length, 2);

  const center = buildPlatformCapabilityOperationsCenter({ platformCapabilityReviews: reviewed.reviews }, { evidenceExists: () => true });
  assert.equal(center.summary.reviewedPreproduction, 1);
  assert.equal(center.productionReady, false);
});

test("platform production blocker workflow requires remediation, evidence submission and site acceptance", () => {
  const data = { platformProductionBlockerReviews: seedPlatformProductionBlockerReviews() };
  const initial = buildPlatformCapabilityOperationsCenter(data, { evidenceExists: () => true });
  assert.equal(initial.summary.blockersOpen, 10);
  assert.equal(initial.summary.blockerEvidenceReviewed, 0);

  assert.throws(
    () => applyPlatformProductionBlockerAction(data, "P0-02", {
      action: "submit-evidence",
      note: "Attempted to submit before remediation."
    }, { name: "Release Reviewer", role: "commission" }),
    (error) => error.code === "PLATFORM_PRODUCTION_BLOCKER_REMEDIATION_REQUIRED" && error.statusCode === 409
  );

  const started = applyPlatformProductionBlockerAction(data, "P0-02", {
    action: "start-remediation",
    note: "Database remediation has started."
  }, { name: "Release Reviewer", role: "commission" });
  const evidence = applyPlatformProductionBlockerAction({ platformProductionBlockerReviews: started.reviews }, "P0-02", {
    action: "record-evidence",
    evidenceRef: "ticket:DB-CUTOVER-02",
    note: "Recorded the database rehearsal ticket."
  }, { name: "Release Reviewer", role: "commission" });
  const submitted = applyPlatformProductionBlockerAction({ platformProductionBlockerReviews: evidence.reviews }, "P0-02", {
    action: "submit-evidence",
    note: "Submitted current database rehearsal evidence."
  }, { name: "Release Reviewer", role: "commission" });
  const reviewed = applyPlatformProductionBlockerAction({ platformProductionBlockerReviews: submitted.reviews }, "P0-02", {
    action: "review-evidence",
    note: "Reviewed current evidence; site acceptance remains required."
  }, { name: "Release Reviewer", role: "commission" });
  assert.equal(reviewed.item.workflowStatus, "evidence-reviewed-site-pending");
  assert.equal(reviewed.item.siteAcceptanceRequired, true);
  assert.equal(reviewed.item.productionReady, false);
  assert.equal(reviewed.item.actionHistory.length, 4);

  const center = buildPlatformCapabilityOperationsCenter({ platformProductionBlockerReviews: reviewed.reviews }, { evidenceExists: () => true });
  assert.equal(center.summary.blockerEvidenceReviewed, 1);
  assert.equal(center.summary.blockerEvidenceRecorded, 1);
  assert.equal(center.productionReady, false);

  const reopened = applyPlatformProductionBlockerAction({ platformProductionBlockerReviews: reviewed.reviews }, "P0-02", {
    action: "reopen",
    note: "Capacity evidence changed and remediation must resume."
  }, { name: "Release Reviewer", role: "commission" });
  assert.equal(reopened.item.workflowStatus, "in-progress");
  assert.equal(reopened.item.productionReady, false);
});

test("platform production audit does not require ignored release artifacts before report generation", () => {
  const report = buildPlatformProductionAudit({
    evidenceExists: (item) => !item.startsWith("release/")
  });
  assert.equal(report.ok, true);
  assert.equal(report.capabilities.every((item) => item.evidenceReady), true);
  assert.equal(report.capabilities.some((item) => item.generatedEvidence.some((evidence) => !evidence.present)), true);
});

test("platform production audit renders and writes machine-readable and formal reports", (t) => {
  const outputDir = path.join(ROOT, "tmp", "platform-production-audit-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const report = buildPlatformProductionAudit({
    document: ["审计结论", "正式生产前已实现的主要功能", "生产割接差距", "下一步开发规划", "正式上线退出条件"].join("\n")
  });
  const markdown = renderMarkdown(report);

  assert.match(markdown, /正式生产前已实现的主要功能/);
  assert.match(markdown, /MVP 剩余必开发模块/);
  assert.match(markdown, /统一身份与消息网关/);
  assert.match(markdown, /P0-10/);
  assert.match(markdown, /P0 \/ 0-30 天/);
  assert.match(markdown, /生产割接清单达到 10\/10/);
  assert.match(markdown, /platform:production-audit/);

  writeOutput(report, {
    output: "tmp/platform-production-audit-test/audit.json",
    markdown: "tmp/platform-production-audit-test/audit.md",
    document: "tmp/platform-production-audit-test/formal.md"
  });

  const written = JSON.parse(fs.readFileSync(path.join(outputDir, "audit.json"), "utf8"));
  assert.equal(written.productionReady, false);
  assert.match(fs.readFileSync(path.join(outputDir, "formal.md"), "utf8"), /正式上线退出条件/);
});

test("platform production audit CLI parser keeps output paths", () => {
  assert.deepEqual(parseArgs(["--output=release/audit.json", "--document=docs/audit.md"]), {
    output: "release/audit.json",
    document: "docs/audit.md"
  });
});
