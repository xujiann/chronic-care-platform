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

function currentReleaseBinding() {
  const sourceSnapshot = {
    version: 1,
    commitSha: "test-commit",
    sourceTreeSha256: "source-tree",
    sourceFileCount: 5,
    packageSha256: "package",
    dataSha256: "data",
    profile: "demo",
    configFile: ".env.example",
    dataFile: "db.json"
  };
  return {
    releaseReport: {
      generatedAt: "2026-07-25T00:00:00.000Z",
      profile: "demo",
      summary: { total: 374, passed: 374 },
      sourceSnapshot
    },
    currentSourceSnapshot: { ...sourceSnapshot }
  };
}

test("platform production audit separates implemented capabilities from production readiness", () => {
  const document = ["审计结论", "正式生产前已实现的主要功能", "生产割接差距", "下一步开发规划", "正式上线退出条件"].join("\n");
  const report = buildPlatformProductionAudit({
    ...currentReleaseBinding(),
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
  assert.equal(report.summary.identityLifecycleAdapter, true);
  assert.equal(report.summary.smsDeliveryCallbackAdapter, true);
  assert.equal(report.summary.financialCallbackReconciliationAdapter, true);
  assert.equal(report.summary.releaseReportFresh, true);
  assert.equal(report.summary.cutoverPassed, 1);
  assert.equal(report.summary.cutoverBlocked, 9);
  assert.equal(report.capabilities.every((item) => item.evidenceReady && item.boundary), true);
  assert.equal(report.productionBlockers.every((item) => item.owner && item.evidence && item.doneWhen), true);
  assert.equal(report.productionBlockers.find((item) => item.id === "P0-01").status, "automation-foundation-ready-site-acceptance-pending");
  assert.match(report.productionBlockers.find((item) => item.id === "P0-01").progress, /不可变部署包/);
  assert.equal(report.productionBlockers.find((item) => item.id === "P0-02").status, "primary-read-production-adapter-ready-site-acceptance-pending");
  assert.match(report.productionBlockers.find((item) => item.id === "P0-02").progress, /SERIALIZABLE 主写/);
  assert.equal(report.productionBlockers.find((item) => item.id === "P0-03").status, "identity-lifecycle-ready-site-joint-test-pending");
  assert.match(report.productionBlockers.find((item) => item.id === "P0-03").progress, /SCIM 目录预览/);
  assert.equal(report.productionBlockers.find((item) => item.id === "P0-04").status, "signed-delivery-callback-ready-site-joint-test-pending");
  assert.match(report.productionBlockers.find((item) => item.id === "P0-04").progress, /nonce 重放防护/);
  assert.equal(report.productionBlockers.find((item) => item.id === "P0-05").status, "adapter-foundation-ready-site-joint-test-pending");
  assert.equal(report.productionBlockers.find((item) => item.id === "P0-06").status, "signed-callback-reconciliation-ready-site-joint-test-pending");
  assert.match(report.productionBlockers.find((item) => item.id === "P0-06").progress, /摘要级日终对账/);
  assert.equal(report.productionBlockers.find((item) => item.id === "P0-08").status, "adapter-foundation-ready-site-joint-test-pending");
  assert.equal(report.productionBlockers.find((item) => item.id === "P0-09").status, "adapter-foundation-ready-site-joint-test-pending");
  assert.match(report.productionBlockers.find((item) => item.id === "P0-09").progress, /失败运维事件/);
  assert.equal(report.mvpRequiredModules.find((item) => item.id === "mvp-identity-message").status, "identity-sms-callback-ready-site-joint-test-pending");
  assert.equal(report.mvpRequiredModules.find((item) => item.id === "mvp-hospital-connectors").status, "adapter-foundation-ready");
  assert.equal(report.mvpRequiredModules.find((item) => item.id === "mvp-payment-insurance").status, "signed-callback-reconciliation-ready-site-joint-test-pending");
  assert.equal(report.mvpRequiredModules.find((item) => item.id === "mvp-object-storage").status, "adapter-foundation-ready");
  assert.equal(report.mvpRequiredModules.find((item) => item.id === "mvp-observability-audit").status, "adapter-foundation-ready");
  assert.equal(report.mvpRequiredModules.find((item) => item.id === "mvp-secrets-deployment").status, "automation-foundation-ready");
  assert.equal(report.mvpRequiredModules.find((item) => item.id === "mvp-production-database").status, "primary-read-production-adapter-ready-site-acceptance-pending");
  assert.equal(report.mvpRequiredModules.every((item) => item.remainingCode && item.siteDependency), true);
  assert.deepEqual(report.roadmap.map((item) => item.phase), ["P0 / 0-30 天", "P1 / 31-60 天", "P2 / 61-90 天", "持续优化 / 90 天后"]);
  assert.equal(report.checks.find((item) => item.id === "platformAudit:capabilityOperationsCenter").passed, true);
  assert.equal(report.checks.find((item) => item.id === "platformAudit:productionDatabaseAdapter").passed, true);
  assert.equal(report.checks.find((item) => item.id === "platformAudit:identityLifecycleAdapter").passed, true);
  assert.equal(report.checks.find((item) => item.id === "platformAudit:smsDeliveryCallback").passed, true);
  assert.equal(report.checks.find((item) => item.id === "platformAudit:financialCallbackReconciliation").passed, true);
  assert.equal(report.checks.find((item) => item.id === "platformAudit:releaseArtifactFreshness").passed, true);
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

  assert.throws(
    () => applyPlatformProductionBlockerAction({ platformProductionBlockerReviews: reviewed.reviews }, "P0-02", {
      action: "record-site-acceptance",
      acceptanceId: "site-db-acceptance-001",
      signers: [{ role: "business", name: "Business Owner" }],
      note: "Incomplete signers must be rejected."
    }, { name: "Release Reviewer", role: "commission" }),
    (error) => error.code === "PLATFORM_SITE_ACCEPTANCE_SIGNERS_INCOMPLETE" && error.statusCode === 409
  );

  const accepted = applyPlatformProductionBlockerAction({ platformProductionBlockerReviews: reviewed.reviews }, "P0-02", {
    action: "record-site-acceptance",
    acceptanceId: "site-db-acceptance-001",
    signers: [
      { role: "business", name: "Business Owner" },
      { role: "information", name: "Information Owner" },
      { role: "operations", name: "Operations Owner" },
      { role: "security", name: "Security Owner" }
    ],
    note: "Site acceptance is recorded but formal go-live remains blocked."
  }, { name: "Release Reviewer", role: "commission" });
  assert.equal(accepted.item.workflowStatus, "site-accepted");
  assert.equal(accepted.item.siteAcceptanceRequired, false);
  assert.equal(accepted.item.siteAcceptance.signers.length, 4);
  assert.equal(accepted.item.productionReady, false);

  const acceptedCenter = buildPlatformCapabilityOperationsCenter({ platformProductionBlockerReviews: accepted.reviews }, { evidenceExists: () => true });
  assert.equal(acceptedCenter.summary.blockersSiteAccepted, 1);
  assert.equal(acceptedCenter.formalGoLiveState, "blocked-until-site-acceptance");
  assert.equal(acceptedCenter.productionReady, false);

  const revoked = applyPlatformProductionBlockerAction({ platformProductionBlockerReviews: accepted.reviews }, "P0-02", {
    action: "revoke-site-acceptance",
    note: "Database capacity evidence changed."
  }, { name: "Release Reviewer", role: "commission" });
  assert.equal(revoked.item.workflowStatus, "in-progress");
  assert.equal(revoked.item.siteAcceptance.status, "revoked");

  const reopened = applyPlatformProductionBlockerAction({ platformProductionBlockerReviews: reviewed.reviews }, "P0-02", {
    action: "reopen",
    note: "Capacity evidence changed and remediation must resume."
  }, { name: "Release Reviewer", role: "commission" });
  assert.equal(reopened.item.workflowStatus, "in-progress");
  assert.equal(reopened.item.productionReady, false);
});

test("platform production audit does not require ignored release artifacts before report generation", () => {
  const report = buildPlatformProductionAudit({
    ...currentReleaseBinding(),
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
    ...currentReleaseBinding(),
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
  assert.equal(written.releaseReportBinding.fresh, true);
  assert.match(fs.readFileSync(path.join(outputDir, "formal.md"), "utf8"), /正式上线退出条件/);
});

test("platform production audit invalidates a release report after source or data drift", () => {
  const binding = currentReleaseBinding();
  const report = buildPlatformProductionAudit({
    ...binding,
    currentSourceSnapshot: {
      ...binding.currentSourceSnapshot,
      sourceTreeSha256: "changed-source-tree",
      dataSha256: "changed-data"
    }
  });

  assert.equal(report.ok, false);
  assert.equal(report.summary.releaseReportFresh, false);
  assert.deepEqual(report.releaseReportBinding.mismatches, ["sourceTreeSha256", "dataSha256"]);
  assert.equal(report.checks.find((item) => item.id === "platformAudit:releaseArtifactFreshness").passed, false);
  assert.match(renderMarkdown(report), /归档结果不得用于 go\/no-go/);
});

test("platform production audit CLI parser keeps output paths", () => {
  assert.deepEqual(parseArgs([
    "--output=release/audit.json",
    "--document=docs/audit.md",
    "--release-report=release/release-report.json",
    "--data-file=release/frozen-db.json"
  ]), {
    output: "release/audit.json",
    document: "docs/audit.md",
    "release-report": "release/release-report.json",
    "data-file": "release/frozen-db.json"
  });
});
