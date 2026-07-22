#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const {
  DEFAULT_INFECTIOUS_EVENT_LINK,
  INFECTIOUS_REPORTING_STAGES,
  REQUIRED_EVENT_FIELDS,
  REQUIRED_REPORT_FIELDS,
  applyInfectiousReportingAction,
  buildInfectiousReportingCaseFromSources,
  runInfectiousReportingAcceptanceScenario,
  upsertInfectiousReportingCase
} = require("../public-health-event-reporting-service");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "public-health-event-reporting-readiness-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "public-health-event-reporting-readiness-report.md");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function check(id, passed, detail, category = "event-reporting") {
  return { id, passed: Boolean(passed), detail, category };
}

function apply(workflow, payload, user) {
  return applyInfectiousReportingAction(workflow, payload, user).case;
}

function buildRejectedReceiptScenario(initial) {
  const institution = { name: "医院传染病报告员", role: "institution" };
  const adapter = { name: "疾控直报回执适配器", role: "system" };
  let workflow = JSON.parse(JSON.stringify(initial));
  workflow = apply(workflow, { action: "validate-event", idempotencyKey: "readiness:reject:validate" }, institution);
  workflow = apply(workflow, { action: "create-report-card", idempotencyKey: "readiness:reject:card" }, institution);
  workflow = apply(workflow, { action: "submit-report", idempotencyKey: "readiness:reject:submit" }, institution);
  workflow = apply(workflow, {
    action: "record-receipt",
    idempotencyKey: "readiness:reject:receipt",
    receiptStatus: "rejected",
    receiptCode: "CDC-REJECT-READINESS-001",
    receivedAt: "2026-07-08T08:45:00+08:00",
    reason: "正式字段版本不匹配",
    exceptionOwner: "疾控直报接口专班",
    dueAt: "2026-07-08T10:45:00+08:00"
  }, adapter);
  return workflow;
}

function verifyRoleGuard(initial) {
  try {
    applyInfectiousReportingAction(initial, { action: "validate-event", idempotencyKey: "readiness:citizen" }, { name: "居民", role: "citizen" });
    return false;
  } catch (error) {
    return /not allowed/.test(error.message);
  }
}

function buildPublicHealthEventReportingReadiness(options = {}) {
  const data = options.data || readJson("data/db.json");
  const link = options.link || DEFAULT_INFECTIOUS_EVENT_LINK;
  const event = options.event || (data.publicHealthEvents || []).find((item) => item.id === link.publicHealthEventId);
  const report = options.report || (data.phase2DiseaseReportQueue || []).find((item) => item.id === link.reportId);
  const receipt = options.receipt || (data.phase2DiseaseReportReceipts || []).find((item) => item.reportId === link.reportId);
  const doc = options.doc ?? readText("docs/public-health-event-reporting-closure.md");
  const serviceSource = options.serviceSource ?? readText("public-health-event-reporting-service.js");
  const testSource = options.testSource ?? readText("test/public-health-event-reporting-service.test.js");

  let initial = null;
  let closed = null;
  let rejected = null;
  let buildError = "";
  try {
    initial = buildInfectiousReportingCaseFromSources({ event, report, receipt, link });
    closed = runInfectiousReportingAcceptanceScenario(initial);
    rejected = buildRejectedReceiptScenario(initial);
  } catch (error) {
    buildError = error.message;
  }

  let intakeIdempotent = false;
  if (initial) {
    const first = upsertInfectiousReportingCase([], initial);
    const duplicate = upsertInfectiousReportingCase(first.cases, initial);
    intakeIdempotent = first.created && duplicate.idempotent && duplicate.cases.length === 1;
  }

  const stageTimeline = closed
    ? closed.timeline.filter((item) => item.action !== "review-standard-mapping").map((item) => item.to)
    : [];
  const checks = [
    check("source:stable-link", initial && initial.externalEventId && initial.publicHealthEventId === link.publicHealthEventId && initial.reportId === link.reportId, initial ? `${initial.externalEventId} links ${initial.publicHealthEventId} to ${initial.reportId}` : buildError, "source"),
    check("contract:event-required-fields", initial && REQUIRED_EVENT_FIELDS.every((field) => String(initial.event[field] || "").trim()), `${REQUIRED_EVENT_FIELDS.length} event fields required`, "contract"),
    check("contract:report-required-fields", initial && REQUIRED_REPORT_FIELDS.every((field) => String(initial.draftReport[field] || "").trim()), `${REQUIRED_REPORT_FIELDS.length} report fields required`, "contract"),
    check("workflow:seven-stages", closed && JSON.stringify(stageTimeline) === JSON.stringify(INFECTIOUS_REPORTING_STAGES), `${stageTimeline.length}/${INFECTIOUS_REPORTING_STAGES.length} stages exercised`, "workflow"),
    check("workflow:accepted-receipt", closed?.receipt?.receiptStatus === "accepted" && /^sha256:[a-f0-9]{64}$/.test(closed?.receipt?.auditHash || ""), closed?.receipt?.receiptCode || "accepted receipt missing", "workflow"),
    check("workflow:rejected-compensation", rejected?.state === "rejected" && rejected?.exception?.status === "open" && rejected?.exception?.owner && rejected?.exception?.dueAt, rejected ? `${rejected.exception.owner} / ${rejected.exception.dueAt}` : buildError, "workflow"),
    check("workflow:idempotent-intake", intakeIdempotent, "duplicate externalEventId returns the existing case", "safety"),
    check("workflow:role-guard", initial && verifyRoleGuard(initial), "citizen role cannot validate or report a case", "safety"),
    check("standard:mapping-reviewed", closed?.standardMapping?.domainId === "ph-infectious" && closed?.standardMapping?.status === "reviewed" && closed?.standardMapping?.evidenceRefs?.length >= 2, `${closed?.standardMapping?.evidenceRefs?.length || 0} mapping evidence refs`, "standard"),
    check("audit:human-decisions", closed?.timeline?.every((item) => item.actor && item.role && item.at) && closed?.cdcReview?.reviewer && closed?.followup?.closedBy, `${closed?.timeline?.length || 0} auditable timeline entries`, "audit"),
    check("acceptance:business-closure", closed?.businessClosureComplete === true && closed?.state === "followup-closed", closed?.state || buildError, "acceptance"),
    check("launch:production-boundary", closed?.productionReady === false, "business closure does not replace formal interface receipt and site signoff", "launch"),
    check("implementation:service-contract", ["applyInfectiousReportingAction", "upsertInfectiousReportingCase", "record-receipt", "review-standard-mapping"].every((token) => serviceSource.includes(token)), "domain service exports state, idempotency, receipt and mapping controls", "implementation"),
    check("tests:negative-paths", ["missing source evidence", "idempotent", "rejected direct-report receipt", "human role", "standard mapping evidence"].every((token) => testSource.includes(token)), "unit tests cover happy path and safety failures", "tests"),
    check("docs:t00-handoff", ["server.js", "package.json", "T00", "externalEventId", "receiptStatus", "productionReady"].every((token) => doc.includes(token)), "T00 integration and production boundary are documented", "docs")
  ];

  return {
    generatedAt: new Date().toISOString(),
    ok: checks.every((item) => item.passed),
    functionalState: closed?.businessClosureComplete ? "business-closure-runnable" : "incomplete",
    formalGoLiveState: "blocked-until-t00-integration-and-site-receipt-signed",
    summary: {
      checks: checks.length,
      passed: checks.filter((item) => item.passed).length,
      stages: INFECTIOUS_REPORTING_STAGES.length,
      timelineEntries: closed?.timeline?.length || 0,
      standardEvidenceRefs: closed?.standardMapping?.evidenceRefs?.length || 0,
      rejectedExceptionAssigned: Boolean(rejected?.exception?.owner && rejected?.exception?.dueAt)
    },
    link,
    initialCase: initial,
    acceptedScenario: closed,
    rejectedScenario: rejected,
    checks,
    artifacts: {
      service: "public-health-event-reporting-service.js",
      test: "test/public-health-event-reporting-service.test.js",
      documentation: "docs/public-health-event-reporting-closure.md",
      report: "release/public-health-event-reporting-readiness-report.md"
    },
    t00Integration: [
      "Expose the service through server.js without duplicating domain transitions.",
      "Add package.json check/test/readiness wiring.",
      "Integrate API and aggregate release evidence after endpoint tests pass."
    ]
  };
}

function cleanTable(value) {
  return String(value ?? "").replace(/\|/g, "/").replace(/\r?\n/g, " ");
}

function renderMarkdown(report) {
  return [
    "# Public health infectious event reporting readiness",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Functional state: ${report.functionalState}`,
    `- Formal go-live state: ${report.formalGoLiveState}`,
    `- Stable link: ${report.link.externalEventId} -> ${report.link.publicHealthEventId} -> ${report.link.reportId}`,
    `- Workflow stages: ${report.summary.stages}`,
    "",
    "## Checks",
    "",
    "| Status | Category | Check | Detail |",
    "|---|---|---|---|",
    ...report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.category} | ${item.id} | ${cleanTable(item.detail)} |`),
    "",
    "## T00 integration boundary",
    "",
    ...report.t00Integration.map((item) => `- ${item}`),
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
  return {
    output: flags.output || DEFAULT_OUTPUT,
    markdown: flags.markdown || DEFAULT_MARKDOWN
  };
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
  const report = buildPublicHealthEventReportingReadiness();
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
  buildPublicHealthEventReportingReadiness,
  parseArgs,
  renderMarkdown,
  writeOutput
};
