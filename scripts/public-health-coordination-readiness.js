#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const defaultData = require("../data/db.json");
const { buildPublicHealthSystem } = require("./public-health-readiness");
const { runPublicHealthCoordinationAcceptanceScenario } = require("../public-health-coordination-service");
const { buildPublicHealthCoordinationRuntime } = require("../public-health-coordination-runtime");
const { buildPublicHealthExternalAdapterRegistry } = require("../public-health-external-adapter-service");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "public-health-coordination-readiness-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "public-health-coordination-readiness-report.md");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function check(id, passed, detail, category = "coordination") {
  return { id, passed: Boolean(passed), detail, category };
}

function buildPublicHealthCoordinationReadiness(options = {}) {
  const system = options.system || buildPublicHealthSystem(options);
  const center = options.center || system.coordinationCenter;
  const accepted = center ? runPublicHealthCoordinationAcceptanceScenario(center) : null;
  const runtime = center ? buildPublicHealthCoordinationRuntime({
    data: options.data || defaultData,
    eventReporting: system.infectiousEventReporting,
    standardReview: system.priorityStandardReview,
    center
  }) : null;
  const adapterRegistry = buildPublicHealthExternalAdapterRegistry({});
  const serviceSource = options.serviceSource ?? read("public-health-coordination-service.js");
  const serviceTestSource = options.serviceTestSource ?? read("test/public-health-coordination-service.test.js");
  const runtimeSource = options.runtimeSource ?? read("public-health-coordination-runtime.js");
  const adapterSource = options.adapterSource ?? read("public-health-external-adapter-service.js");
  const adapterRuntimeSource = options.adapterRuntimeSource ?? read("public-health-external-adapter-runtime.js");
  const operationsSource = options.operationsSource ?? read("public-health-external-operations-service.js");
  const publicHealthSource = options.publicHealthSource ?? read("public-health.js");
  const publicHealthHtml = options.publicHealthHtml ?? read("public-health.html");
  const systemBuilderSource = options.systemBuilderSource ?? read("scripts/public-health-readiness.js");
  const doc = options.doc ?? read("docs/public-health-eight-domain-coordination.md");
  const lane = (id) => center?.lanes?.find((item) => item.id === id);
  const handoff = (id) => center?.handoffs?.find((item) => item.laneId === id);
  const checks = [
    check("scope:eight-lanes", center?.summary?.lanes === 8 && center?.lanes?.length === 8, `${center?.summary?.lanes || 0}/8 lanes`, "scope"),
    check("scope:all-structurally-ready", center?.summary?.structurallyReady === 8 && center?.lanes?.every((item) => item.structurallyReady), `${center?.summary?.structurallyReady || 0}/8 structurally ready`, "scope"),
    check("lane:infectious-reporting", lane("infectious-reporting")?.standardDomainIds?.includes("ph-infectious") && handoff("infectious-reporting")?.sourceRefs?.length >= 2, handoff("infectious-reporting")?.sourceRefs?.join(" -> ") || "missing", "lane"),
    check("lane:immunization", lane("immunization")?.requiredEvidence?.includes("cold-chain-receipt") && lane("immunization")?.requiredEvidence?.includes("aefi-handoff"), lane("immunization")?.requiredEvidence?.join(", ") || "missing", "lane"),
    check("lane:maternal-child", lane("maternal-child")?.requiredEvidence?.includes("maternal-enrollment-receipt") && lane("maternal-child")?.requiredEvidence?.includes("public-security-receipt"), lane("maternal-child")?.requiredEvidence?.join(", ") || "missing", "lane"),
    check("lane:senior-health", lane("senior-health")?.sourceCollections?.includes("seniorServices") && lane("senior-health")?.requiredEvidence?.includes("family-doctor-handoff"), `${lane("senior-health")?.metrics?.total || 0} senior source rows`, "lane"),
    check("lane:chronic-management", lane("chronic-management")?.sourceCollections?.includes("chronicScreeningTasks") && lane("chronic-management")?.sourceCollections?.includes("chronicManagementPlans"), `${lane("chronic-management")?.metrics?.open || 0} open chronic rows`, "lane"),
    check("lane:public-health-followup", lane("public-health-followup")?.standardDomainIds?.includes("ph-archive") && lane("public-health-followup")?.requiredEvidence?.includes("resident-feedback"), handoff("public-health-followup")?.sourceRefs?.join(" / ") || "missing", "lane"),
    check("lane:health-education", lane("health-education")?.sourceCollections?.includes("chronicEducationPushes") && lane("health-education")?.requiredEvidence?.includes("effect-evaluation"), `${lane("health-education")?.metrics?.open || 0} open education rows`, "lane"),
    check("lane:family-doctor", lane("family-doctor")?.sourceCollections?.includes("phase2FamilyDoctorContracts") && lane("family-doctor")?.requiredEvidence?.includes("fulfillment-receipt"), handoff("family-doctor")?.sourceRefs?.join(" / ") || "missing", "lane"),
    check("link:event-reporting", center?.summary?.eventReportingLinked === true && center?.eventReporting?.publicHealthEventId && center?.eventReporting?.reportId, `${center?.eventReporting?.publicHealthEventId || "missing"} -> ${center?.eventReporting?.reportId || "missing"}`, "link"),
    check("link:standard-review", center?.summary?.standardReviewTracks === 8 && center?.standardReview?.summary?.standardDomains === 7, `${center?.summary?.standardReviewTracks || 0} tracks / ${center?.standardReview?.summary?.standardDomains || 0} domains`, "link"),
    check("acceptance:eight-closures", accepted?.summary?.closedHandoffs === 8 && accepted?.handoffs?.every((item) => item.businessClosureComplete), `${accepted?.summary?.closedHandoffs || 0}/8 business closures`, "acceptance"),
    check("acceptance:audit-timeline", accepted?.summary?.auditEntries === 32 && accepted?.handoffs?.every((item) => item.timeline?.length === 4), `${accepted?.summary?.auditEntries || 0} audit entries`, "acceptance"),
    check("acceptance:exact-evidence", accepted?.handoffs?.every((item) => JSON.stringify([...item.closure.evidenceRefs].sort()) === JSON.stringify([...item.requiredEvidence].sort())), "all closures preserve exact lane evidence", "acceptance"),
    check("safety:exception-retry", ["exception-open", "retry-coordination", "exceptionOwner", "dueAt"].every((token) => serviceSource.includes(token)), "rejected receipts open assigned exceptions and retry safely", "safety"),
    check("safety:role-idempotency-version", ["ownerRole", "idempotencyKey", "expectedVersion", "version conflict"].every((token) => serviceSource.includes(token)) && serviceTestSource.includes("authorized idempotent replay"), "lane roles, idempotency and optimistic version checks are enforced", "safety"),
    check("runtime:persistence-model", runtime?.handoffs?.length === 8 && runtime?.functionalState === "eight-lane-coordination-persistence-ready", `${runtime?.handoffs?.length || 0}/8 persistence-ready handoffs`, "runtime"),
    check("runtime:persisted-invariants", ["PERSISTED_OPERATIONAL_FIELDS", "isCompatiblePersistedHandoff", "publicHealthCoordinationAudit", "rejectedPersistedHandoffs"].every((token) => runtimeSource.includes(token)), "persisted operational fields are allowlisted and invariant tampering is rejected", "runtime"),
    check("adapter:eight-profiles", adapterRegistry?.summary?.adapters === 8 && adapterRegistry?.productionReady === false, `${adapterRegistry?.summary?.adapters || 0}/8 fail-closed adapter profiles`, "adapter"),
    check("adapter:signed-retry-dead-letter", ["HMAC-SHA256", "timingSafeEqual", "retry-scheduled", "dead-letter", "productionReady: false"].every((token) => adapterSource.includes(token)), "signed receipts, retry and dead-letter compensation remain fail-closed", "adapter"),
    check("adapter:persistent-outbox-link", ["publicHealthExternalDispatches", "runtimeStateSignature", "recordPublicHealthExternalAttemptToState", "open-coordination-exception"].every((token) => adapterRuntimeSource.includes(token)), "signed persistent outbox links verified callbacks and dead letters to coordination state", "adapter"),
    check("adapter:worker-lease", ["listDuePublicHealthExternalDispatches", "claimPublicHealthExternalDispatchToState", "recordClaimedPublicHealthExternalAttemptToState", "leaseToken", "outboxVersion", "external dispatch version conflict"].every((token) => adapterRuntimeSource.includes(token)), "due selection, signed version, worker lease, claimed attempt and token checks prevent concurrent delivery", "adapter"),
    check("adapter:dead-letter-recovery", ["requeuePublicHealthExternalDeadLetterToState", "remediationEvidenceRefs", "successorDispatchId", "approvedByRole"].every((token) => adapterRuntimeSource.includes(token)), "authorized remediation seals each dead letter and creates one linked successor", "adapter"),
    check("adapter:signed-audit-chain", ["verifyPublicHealthExternalAuditChain", "previousAuditHash", "auditSignature", "auditHead"].every((token) => adapterRuntimeSource.includes(token)), "every outbox write verifies and advances a signed per-dispatch audit chain", "adapter"),
    check("operations:reconciliation-board", ["buildPublicHealthExternalOperationsBoard", "coordination-state-mismatch", "worker-lease-expired", "dead-letter-unrecovered"].every((token) => operationsSource.includes(token)), "operations board reconciles signatures, coordination state, leases, SLA and dead letters", "operations"),
    check("runtime:system-builder", system.coordinationCenter?.summary?.lanes === 8 && systemBuilderSource.includes("buildPublicHealthCoordinationCenter") && systemBuilderSource.includes("coordinationCenter"), "buildPublicHealthSystem returns coordinationCenter", "runtime"),
    check("frontend:panel", publicHealthHtml.includes("public-health-coordination-center") && publicHealthSource.includes("renderPublicHealthCoordinationCenter"), "public health page renders the coordination center", "frontend"),
    check("frontend:static-fallback", publicHealthSource.includes("buildStaticCoordinationCenter") && publicHealthSource.includes("eight-lane-static-coordination-runnable"), "file preview builds a local eight-lane fallback", "frontend"),
    check("frontend:action-contract", ["handlePublicHealthCoordinationAction", "assign-coordination", "record-coordination-receipt", "retry-coordination", "close-coordination", "reopen-coordination", "/api/public-health/coordination/", "expectedVersion", "idempotencyKey"].every((token) => publicHealthSource.includes(token)), "six coordination actions carry role-ready idempotent versioned payloads to the public route boundary", "frontend"),
    check("launch:production-boundary", center?.productionReady === false && accepted?.productionReady === false && /blocked/.test(center?.formalGoLiveState || ""), center?.formalGoLiveState || "missing", "launch"),
    check("docs:t00-boundary", ["T00", "server.js", "package.json", "现场证据", "八领域", "productionReady"].every((token) => doc.includes(token)), "completion scope and remaining T00 integration are documented", "docs")
  ];
  return {
    generatedAt: new Date().toISOString(),
    ok: checks.every((item) => item.passed),
    functionalState: accepted?.summary?.closedHandoffs === 8 ? "eight-domain-coordination-complete" : "incomplete",
    formalGoLiveState: "blocked-until-t00-route-writer-production-endpoints-and-site-evidence-verified",
    summary: {
      checks: checks.length,
      passed: checks.filter((item) => item.passed).length,
      lanes: center?.summary?.lanes || 0,
      structurallyReady: center?.summary?.structurallyReady || 0,
      handoffs: center?.summary?.handoffs || 0,
      acceptanceClosed: accepted?.summary?.closedHandoffs || 0,
      auditEntries: accepted?.summary?.auditEntries || 0,
      externalDependencies: center?.summary?.externalDependencies || 0
    },
    center,
    acceptanceScenario: accepted,
    checks,
    artifacts: {
      service: "public-health-coordination-service.js",
      runtime: "public-health-coordination-runtime.js",
      externalAdapters: "public-health-external-adapter-service.js",
      externalAdapterRuntime: "public-health-external-adapter-runtime.js",
      externalOperations: "public-health-external-operations-service.js",
      page: "public-health.html",
      pageController: "public-health.js",
      test: "test/public-health-coordination-service.test.js",
      documentation: "docs/public-health-eight-domain-coordination.md",
      report: "release/public-health-coordination-readiness-report.md"
    },
    remainingT00Integration: [
      "Wire the public server action route and durable writer to the T08 coordination runtime controller.",
      "Add package scripts, public styling and aggregate release manifest entries.",
      "Provision production adapter endpoints and secrets, run smoke tests, and verify signed receipts and trusted site evidence."
    ]
  };
}

function table(value) {
  return String(value ?? "").replace(/\|/g, "/").replace(/\r?\n/g, " ");
}

function renderMarkdown(report) {
  return [
    "# Public health eight-domain coordination readiness",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Functional state: ${report.functionalState}`,
    `- Formal go-live state: ${report.formalGoLiveState}`,
    `- Lanes: ${report.summary.lanes}`,
    `- Acceptance closures: ${report.summary.acceptanceClosed}`,
    `- Audit entries: ${report.summary.auditEntries}`,
    "",
    "## Checks",
    "",
    "| Status | Category | Check | Detail |",
    "|---|---|---|---|",
    ...report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.category} | ${item.id} | ${table(item.detail)} |`),
    "",
    "## Coordination lanes",
    "",
    "| Lane | Owner | Source rows | Open rows | Standard domains | Formal acceptance |",
    "|---|---|---|---|---|---|",
    ...report.center.lanes.map((item) => `| ${table(item.name)} | ${table(item.owner)} | ${item.metrics.total} | ${item.metrics.open} | ${item.standardDomainIds.join("<br>")} | pending site evidence |`),
    "",
    "## Remaining T00 integration",
    "",
    ...report.remainingT00Integration.map((item) => `- ${item}`),
    ""
  ].join("\n");
}

function parseArgs(argv = process.argv.slice(2)) {
  const flags = {};
  argv.forEach((arg) => {
    if (!arg.startsWith("--")) return;
    const [key, ...rest] = arg.slice(2).split("=");
    flags[key] = rest.length ? rest.join("=") : true;
  });
  return { output: flags.output || DEFAULT_OUTPUT, markdown: flags.markdown || DEFAULT_MARKDOWN };
}

function writeOutput(report, flags = {}) {
  const output = path.resolve(ROOT, String(flags.output || DEFAULT_OUTPUT));
  const markdown = path.resolve(ROOT, String(flags.markdown || DEFAULT_MARKDOWN));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2), "utf8");
  fs.mkdirSync(path.dirname(markdown), { recursive: true });
  fs.writeFileSync(markdown, renderMarkdown(report), "utf8");
}

function runCli() {
  const report = buildPublicHealthCoordinationReadiness();
  writeOutput(report, parseArgs());
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  buildPublicHealthCoordinationReadiness,
  parseArgs,
  renderMarkdown,
  writeOutput
};
