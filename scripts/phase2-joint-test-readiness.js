#!/usr/bin/env node
const { readRuntimeSource } = require("../src/http/runtime-source");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "phase2-joint-test-readiness-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "phase2-joint-test-readiness-report.md");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function check(id, passed, detail) {
  return { id, passed: Boolean(passed), detail };
}

function clean(value) {
  return String(value || "").replace(/\|/g, "/");
}

function defaultInstitutions() {
  return [
    { id: "p2pilot-hospital", role: "tertiary-hospital", name: "Regional Central Hospital", sourceSystems: ["HIS", "EMR", "LIS", "PACS"], signoffStatus: "pending-site-signature", owner: "hospital-integration" },
    { id: "p2pilot-district", role: "district-platform", name: "Ganjingzi district health platform", sourceSystems: ["health-archive", "public-health", "statistics"], signoffStatus: "pending-district-signature", owner: "district-platform" },
    { id: "p2pilot-primary", role: "primary-care", name: "Lingshui community health center", sourceSystems: ["primary-HIS", "family-doctor", "chronic-reporting"], signoffStatus: "pending-primary-signature", owner: "primary-care" }
  ];
}

function defaultLinks() {
  return [
    ["p2link-master-index", "p2pilot-primary", "identity-master-index", "residents", "p2msg-master-index", "p2trace-master-index", "passed-demo"],
    ["p2link-his-patient", "p2pilot-hospital", "his-encounter", "personalRecords", "p2msg-his-visit", "p2trace-his-visit", "passed-demo"],
    ["p2link-emr-summary", "p2pilot-hospital", "emr-summary", "personalRecords", "p2msg-emr-summary", "p2trace-emr-summary", "passed-demo"],
    ["p2link-lis-report", "p2pilot-hospital", "lis-report", "diagnosticReports", "p2msg-lis-report", "p2trace-lis-report", "compensated-demo"],
    ["p2link-health-archive", "p2pilot-district", "health-archive", "personalRecords", "p2msg-health-archive", "p2trace-health-archive", "passed-demo"],
    ["p2link-statistics-indicator", "p2pilot-district", "statistics-indicator", "healthStatisticsIngestion", "p2msg-statistics-indicator", "p2trace-statistics-indicator", "passed-demo"],
    ["p2link-appointment-order", "p2pilot-primary", "appointment-order", "careOrders", "p2msg-appointment-order", "p2trace-appointment-order", "ready-for-site"],
    ["p2link-chronic-report", "p2pilot-primary", "chronic-reporting", "chronicScreeningTasks", "p2msg-chronic-report", "p2trace-chronic-report", "passed-demo"]
  ].map(([id, institutionId, chain, targetCollection, payloadId, traceId, status]) => ({
    id,
    institutionId,
    chain,
    sourceSystem: chain,
    targetCollection,
    contractId: `${chain}-v1`,
    payloadId,
    traceId,
    requiredFields: ["residentId", "externalId", "eventAt"],
    status,
    signoffStatus: "pending-site-signature"
  }));
}

function defaultPayloads() {
  return [
    ["p2msg-master-index", "patient", "P2-MI-20260709-001"],
    ["p2msg-his-visit", "visit", "P2-HIS-20260709-001"],
    ["p2msg-emr-summary", "emr", "P2-EMR-20260709-001"],
    ["p2msg-lis-report", "lab-report", "P2-LIS-20260709-001"],
    ["p2msg-health-archive", "health-archive", "P2-ARCH-20260709-001"],
    ["p2msg-statistics-indicator", "statistics", "P2-STAT-20260709-001"],
    ["p2msg-appointment-order", "appointment", "P2-APPT-20260709-001"],
    ["p2msg-chronic-report", "chronic-report", "P2-CHR-20260709-001"]
  ].map(([id, category, idempotencyKey]) => ({
    id,
    category,
    sourceSystem: category,
    sampleType: category,
    idempotencyKey,
    signatureAlgorithm: "HMAC-SHA256",
    requiredFields: ["residentId", "externalId", "eventAt"],
    sampleHash: `sha256:${id}`,
    status: id === "p2msg-lis-report" ? "validated-after-replay" : "validated"
  }));
}

function defaultTraces() {
  return [
    ["p2trace-master-index", "p2msg-master-index", "residents", "landed"],
    ["p2trace-his-visit", "p2msg-his-visit", "personalRecords", "landed"],
    ["p2trace-emr-summary", "p2msg-emr-summary", "personalRecords", "landed"],
    ["p2trace-lis-report", "p2msg-lis-report", "diagnosticReports", "compensated"],
    ["p2trace-health-archive", "p2msg-health-archive", "personalRecords", "landed"],
    ["p2trace-statistics-indicator", "p2msg-statistics-indicator", "healthStatisticsIngestion", "landed"],
    ["p2trace-appointment-order", "p2msg-appointment-order", "careOrders", "dry-run"],
    ["p2trace-chronic-report", "p2msg-chronic-report", "chronicScreeningTasks", "landed"]
  ].map(([id, payloadId, targetCollection, status]) => ({
    id,
    payloadId,
    route: "/api/integrations/gateway",
    targetCollection,
    status,
    signatureVerified: true,
    idempotencyKey: payloadId.replace("p2msg", "P2").toUpperCase(),
    landedRecordId: `${targetCollection}-${id}`,
    replayStatus: status === "dry-run" ? "site-replay-required" : status === "compensated" ? "replayed-after-dead-letter" : "replayable"
  }));
}

function defaultIssues() {
  return [
    ["p2issue-hospital-secret", "p2pilot-hospital", "P0", "hospital interface account and signature secret handoff"],
    ["p2issue-lis-dictionary", "p2pilot-hospital", "P0", "LIS dictionary and mutual recognition catalog signoff"],
    ["p2issue-district-stat-version", "p2pilot-district", "P1", "district statistics indicator version confirmation"],
    ["p2issue-primary-order-source", "p2pilot-primary", "P1", "primary appointment callback state confirmation"]
  ].map(([id, institutionId, severity, title]) => ({
    id,
    institutionId,
    severity,
    title,
    owner: "joint-test-owner",
    status: "open",
    retestStatus: "pending",
    dueAt: "2026-07-21",
    signoffStatus: "pending-site-signature"
  }));
}

function buildPhase2JointTestReadiness(options = {}) {
  const data = options.data ?? readJson("data/db.json");
  const pkg = options.pkg ?? readJson("package.json");
  const serverSource = options.serverSource ?? readRuntimeSource(ROOT);
  const platformSource = options.platformSource ?? readText("platform.js");
  const platformHtml = options.platformHtml ?? readText("platform.html");
  const manifestSource = options.manifestSource ?? readText(path.join("scripts", "release-artifact-manifest.js"));
  const deployCheckSource = options.deployCheckSource ?? readText(path.join("scripts", "deploy-check.js"));
  const releaseReportSource = options.releaseReportSource ?? readText(path.join("scripts", "release-report.js"));
  const institutions = options.institutions ?? (Array.isArray(data.phase2PilotInstitutions) && data.phase2PilotInstitutions.length ? data.phase2PilotInstitutions : defaultInstitutions());
  const links = options.links ?? (Array.isArray(data.phase2JointTestLinks) && data.phase2JointTestLinks.length ? data.phase2JointTestLinks : defaultLinks());
  const payloads = options.payloads ?? (Array.isArray(data.phase2SamplePayloads) && data.phase2SamplePayloads.length ? data.phase2SamplePayloads : defaultPayloads());
  const traces = options.traces ?? (Array.isArray(data.phase2GatewayTraces) && data.phase2GatewayTraces.length ? data.phase2GatewayTraces : defaultTraces());
  const issues = options.issues ?? (Array.isArray(data.phase2JointTestIssues) && data.phase2JointTestIssues.length ? data.phase2JointTestIssues : defaultIssues());
  const institutionIds = new Set(institutions.map((item) => item.id));
  const payloadIds = new Set(payloads.map((item) => item.id));
  const traceIds = new Set(traces.map((item) => item.id));
  const requiredCategories = ["patient", "visit", "lab-report", "statistics"];
  const landedTraces = traces.filter((item) => /landed|compensated/i.test(String(item.status || "")));
  const replayableTraces = traces.filter((item) => /replay/i.test(String(item.replayStatus || "")));
  const runnableChains = links.filter((item) => /passed|compensated/i.test(String(item.status || "")));
  const openIssues = issues.filter((item) => !/closed|signed/i.test(String(item.status || "")));
  const checks = [
    check("phase2JointTest:pilot-institutions", institutions.length >= 3 && ["tertiary-hospital", "district-platform", "primary-care"].every((role) => institutions.some((item) => item.role === role)), `${institutions.length} pilot institutions`),
    check("phase2JointTest:link-ledger", links.length >= 6 && links.every((item) => institutionIds.has(item.institutionId) && payloadIds.has(item.payloadId) && traceIds.has(item.traceId) && item.requiredFields?.length), `${links.length} institution-system-interface-field links`),
    check("phase2JointTest:sample-payloads", requiredCategories.every((category) => payloads.some((item) => item.category === category)) && payloads.every((item) => item.idempotencyKey && item.signatureAlgorithm && item.sampleHash), `${payloads.length} signed sample payloads`),
    check("phase2JointTest:gateway-landing", landedTraces.length >= 6 && landedTraces.every((item) => item.signatureVerified && item.idempotencyKey && item.targetCollection && item.landedRecordId), `${landedTraces.length} landed or compensated gateway traces`),
    check("phase2JointTest:replayability", replayableTraces.length >= 6, `${replayableTraces.length} replayable traces`),
    check("phase2JointTest:runnable-chains", runnableChains.length >= 5 && ["identity-master-index", "his-encounter", "lis-report", "health-archive", "chronic-reporting"].every((chain) => runnableChains.some((item) => item.chain === chain)), `${runnableChains.length} runnable chains`),
    check("phase2JointTest:issue-retest-ledger", issues.length >= 4 && issues.every((item) => institutionIds.has(item.institutionId) && item.owner && item.dueAt && item.retestStatus && item.signoffStatus), `${issues.length} issue and retest rows`),
    check("phase2JointTest:runtime-api", serverSource.includes("/api/phase2/joint-test-pilot") && serverSource.includes("buildPhase2JointTestPilotOverview") && serverSource.includes("seedPhase2PilotInstitutions"), "runtime API and seed data are wired"),
    check("phase2JointTest:platform-ui", platformSource.includes("renderPhase2JointTestPilot") && platformHtml.includes("phase2-joint-test-pilot"), "platform UI renders the joint-test pilot"),
    check("phase2JointTest:onsite-boundary", openIssues.length >= 3 && institutions.some((item) => /pending/i.test(String(item.signoffStatus || ""))), `${openIssues.length} open onsite signoff issues`),
    check("phase2JointTest:release-wiring", Boolean(pkg.scripts?.["phase2:joint-test-readiness"]) && manifestSource.includes("phase2-joint-test-readiness-report.md") && manifestSource.includes("phase2:joint-test-readiness") && deployCheckSource.includes("phase2JointTestReadiness") && releaseReportSource.includes("phase2JointTest") && releaseReportSource.includes("phase2-joint-test-readiness-report.md"), "package script, manifest, deploy check and release report are wired")
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    summary: {
      institutions: institutions.length,
      sourceSystems: [...new Set(institutions.flatMap((item) => item.sourceSystems || []))].length,
      links: links.length,
      samplePayloads: payloads.length,
      gatewayTraces: traces.length,
      landedTraces: landedTraces.length,
      replayableTraces: replayableTraces.length,
      runnableChains: runnableChains.length,
      openIssues: openIssues.length
    },
    institutions,
    links,
    samplePayloads: payloads,
    gatewayTraces: traces,
    issues,
    checks
  };
}

function renderMarkdown(report) {
  return [
    "# Phase 2 joint-test readiness report",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Pilot institutions: ${report.summary.institutions}`,
    `- Joint-test links: ${report.summary.links}`,
    `- Sample payloads: ${report.summary.samplePayloads}`,
    `- Gateway traces: ${report.summary.landedTraces}/${report.summary.gatewayTraces} landed or compensated`,
    `- Replayable traces: ${report.summary.replayableTraces}`,
    `- Open onsite issues: ${report.summary.openIssues}`,
    "",
    "## Checks",
    "",
    "| Result | Check | Detail |",
    "|---|---|---|",
    ...report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${clean(item.detail)} |`),
    "",
    "## Pilot institutions",
    "",
    "| ID | Role | Name | Systems | Signoff | Owner |",
    "|---|---|---|---|---|---|",
    ...report.institutions.map((item) => `| ${item.id} | ${item.role} | ${clean(item.name)} | ${(item.sourceSystems || []).join(", ")} | ${item.signoffStatus} | ${clean(item.owner)} |`),
    "",
    "## Joint-test links",
    "",
    "| ID | Chain | Target | Payload | Trace | Status |",
    "|---|---|---|---|---|---|",
    ...report.links.map((item) => `| ${item.id} | ${item.chain} | ${item.targetCollection} | ${item.payloadId} | ${item.traceId} | ${item.status} |`),
    "",
    "## Gateway traces",
    "",
    "| ID | Payload | Target | Status | Replay |",
    "|---|---|---|---|---|",
    ...report.gatewayTraces.map((item) => `| ${item.id} | ${item.payloadId} | ${item.targetCollection} | ${item.status} | ${item.replayStatus} |`),
    ""
  ].join("\n");
}

function parseArgs(argv = process.argv.slice(2)) {
  const flags = {};
  argv.forEach((flag) => {
    if (!flag.startsWith("--")) return;
    const [key, ...rest] = flag.slice(2).split("=");
    flags[key] = rest.length ? rest.join("=") : true;
  });
  return flags;
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
  const flags = parseArgs();
  const report = buildPhase2JointTestReadiness();
  if (flags.write !== "false" && flags.write !== false) writeOutput(report, flags);
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

module.exports = { buildPhase2JointTestReadiness, parseArgs, renderMarkdown, writeOutput };
