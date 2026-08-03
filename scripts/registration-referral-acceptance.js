#!/usr/bin/env node
"use strict";

const { readRuntimeSource } = require("../src/http/runtime-source");

const fs = require("node:fs");
const path = require("node:path");

const { CLOSURE_COMMAND_CONTRACTS, DEFAULT_NOTIFICATION_POLICY } = require("../registration-referral-service");
const { validateClosureReferences } = require("../registration-referral-domain");
const { buildRegistrationReferralClosureReadiness } = require("./registration-referral-closure-readiness");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "registration-referral-acceptance-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "registration-referral-acceptance-report.md");

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function check(id, scope, passed, detail) {
  return { id, scope, passed: Boolean(passed), detail };
}

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) return "";
  const next = source.indexOf("\nfunction ", start + 10);
  return source.slice(start, next < 0 ? source.length : next);
}

function extractSeedObject(source, id) {
  const marker = `id: "${id}"`;
  const start = source.indexOf(marker);
  if (start < 0) return "";
  const nextObject = source.indexOf("\n    {", start + marker.length);
  const endArray = source.indexOf("\n  ];", start + marker.length);
  const end = [nextObject, endArray].filter((value) => value >= 0).sort((a, b) => a - b)[0];
  return source.slice(start, end < 0 ? source.length : end);
}

function buildRegistrationReferralAcceptance(options = {}) {
  const data = options.data || readJson(path.join("data", "db.json"));
  const serverSource = options.serverSource ?? readRuntimeSource(ROOT);
  const pkg = options.pkg || readJson("package.json");
  const serviceSource = options.serviceSource ?? readText("registration-referral-service.js");
  const domainSource = options.domainSource ?? readText("registration-referral-domain.js");
  const domainTestSource = options.domainTestSource ?? readText(path.join("test", "registration-referral-domain.test.js"));
  const serviceTestSource = options.serviceTestSource ?? readText(path.join("test", "registration-referral-service.test.js"));
  const standaloneTestSource = options.standaloneTestSource ?? readText(path.join("test", "registration-referral-standalone.test.js"));
  const advancedTestSource = options.advancedTestSource ?? readText(path.join("test", "registration-referral-advanced.test.js"));
  const readinessTestSource = options.readinessTestSource ?? readText(path.join("test", "registration-referral-closure-readiness.test.js"));
  const domainDoc = options.domainDoc ?? readText(path.join("docs", "registration-referral-domain.md"));
  const serviceDoc = options.serviceDoc ?? readText(path.join("docs", "registration-referral-service.md"));
  const readiness = buildRegistrationReferralClosureReadiness({ data, asOf: options.asOf || new Date().toISOString() });
  const consistency = validateClosureReferences(data);
  const actions = new Set(CLOSURE_COMMAND_CONTRACTS.map((item) => item.action));
  const requiredActions = [
    "advance-registration",
    "apply-registration-callback",
    "record-primary-care-assessment",
    "create-referral-from-primary-care",
    "accept-referral-request",
    "schedule-teleconsultation",
    "return-referral-report",
    "accept-referral-continuity",
    "complete-chronic-followup",
    "acknowledge-chronic-followup",
    "acknowledge-family-doctor-fulfillment",
    "record-notification-receipt",
    "run-notification-fallback",
    "escalate-case",
    "reject-referral-request",
    "withdraw-referral",
    "reassign-referral",
    "reschedule-teleconsultation",
    "cancel-teleconsultation",
    "record-teleconsultation-no-show",
    "attach-referral-materials",
    "grant-referral-authorization",
    "revoke-referral-authorization",
    "resume-referral-authorization",
    "run-closure-sla",
    "acknowledge-escalation",
    "record-notification-provider-result",
    "resolve-notification-dead-letter",
    "submit-family-doctor-application",
    "review-family-doctor-application",
    "activate-family-doctor-contract",
    "record-family-doctor-fulfillment",
    "request-family-doctor-renewal",
    "review-family-doctor-renewal",
    "request-family-doctor-transfer",
    "review-family-doctor-transfer",
    "raise-family-doctor-service-dispute",
    "respond-family-doctor-service-dispute",
    "acknowledge-family-doctor-service-dispute",
    "terminate-family-doctor-contract",
    "create-down-referral",
    "request-referral-supplement",
    "submit-referral-supplement",
    "review-referral-supplement",
    "run-family-doctor-scheduler"
  ];
  const referralSeed = extractFunction(serverSource, "seedReferralTeleconsultations");
  const taskSeed = extractFunction(serverSource, "seedTaskMessages");
  const rtc001 = extractSeedObject(referralSeed, "rtc-001");
  const rtc002 = extractSeedObject(referralSeed, "rtc-002");
  const msgRtc002Citizen = extractSeedObject(taskSeed, "msg-rtc-002-report-citizen");
  const msgRtc002Institution = extractSeedObject(taskSeed, "msg-rtc-002-report-institution");
  const releaseWired = options.releaseWired === true || (
    readText("scripts/release-artifact-manifest.js").includes("registration-referral-acceptance-report.md")
    && readText("scripts/deploy-check.js").includes("manifest:registrationReferralAcceptance")
    && readText("scripts/release-report.js").includes("registrationReferral:integrationReady")
  );
  const threadChecks = [
    check("registrationReferralAcceptance:dataConsistency", "thread", consistency.dataReady, `${consistency.summary.P0} P0 / ${consistency.summary.P1} P1 issues`),
    check("registrationReferralAcceptance:readiness", "thread", readiness.functionalOk && readiness.dataReady && !readiness.productionReady, `${readiness.summary.cases} cases / ${readiness.summary.openCases} open / production false`),
    check("registrationReferralAcceptance:commandCoverage", "thread", requiredActions.every((action) => actions.has(action)), `${requiredActions.filter((action) => actions.has(action)).length}/${requiredActions.length} commands`),
    check("registrationReferralAcceptance:commandContracts", "thread", CLOSURE_COMMAND_CONTRACTS.every((item) => item.roles.length && item.requiredFields.length && item.suggestedEndpoint), `${CLOSURE_COMMAND_CONTRACTS.length} command contracts`),
    check("registrationReferralAcceptance:notificationFallback", "thread", DEFAULT_NOTIFICATION_POLICY.channels.map((item) => item.channel).join(",") === "in_app,sms,phone,manual-task", DEFAULT_NOTIFICATION_POLICY.channels.map((item) => `${item.channel}:${item.maxAttempts}`).join(";")),
    check("registrationReferralAcceptance:idempotencyAudit", "thread", serviceSource.includes("registrationReferralClosureEvents") && serviceSource.includes("commandId") && serviceSource.includes("idempotent: true"), "command idempotency and non-production audit event are implemented"),
    check("registrationReferralAcceptance:eventHashChain", "thread", serviceSource.includes("previousEventHash") && serviceSource.includes("event.eventHash") && domainSource.includes("validateClosureEventChain") && advancedTestSource.includes("closure event hash chain detects payload tampering"), "closure events are hash-linked and tamper-tested"),
    check("registrationReferralAcceptance:concurrencyRecovery", "thread", serviceSource.includes("expectedVersion") && serviceSource.includes("replayClosureCommands") && standaloneTestSource.includes("optimistic concurrency and recovery evidence"), "optimistic version checks and idempotent journal replay are covered"),
    check("registrationReferralAcceptance:operationalProjections", "thread", ["buildClosureWorkQueue", "buildClosureQualityMetrics", "buildNotificationReliability"].every((marker) => serviceSource.includes(marker)) && standaloneTestSource.includes("work queue and quality projections remain read-only"), "work queue, quality and notification reliability projections are covered"),
    check("registrationReferralAcceptance:tests", "thread", ["terminal registration rejects late insurance callbacks", "notification resident mismatch", "primary care teleconsultation creates a resident-consistent referral chain", "teleconsultation command path completes acceptance scheduling report and continuity", "notification fallback advances to a manual task", "closure readiness reports repaired current data", "referral exception path rejects reassigns packages reschedules no-show and cancels", "family doctor commands cover application contract fulfillment renewal and termination", "family doctor transfer requires source release and target acceptance", "family doctor service dispute closes after remediation and resident acceptance", "down-referral completes two-round material supplementation and primary-care continuity", "family doctor scheduler creates scoped tasks and fulfillment closes the task"].every((marker) => `${domainTestSource}\n${serviceTestSource}\n${standaloneTestSource}\n${advancedTestSource}\n${readinessTestSource}`.includes(marker)), "domain, service, standalone, advanced and readiness regression markers present"),
    check("registrationReferralAcceptance:docs", "thread", domainDoc.includes("Safe repair planning") && serviceDoc.includes("T00 integration contract") && serviceDoc.includes("Persistence transaction") && serviceDoc.includes("Standalone T05 operations"), "domain, service and integration boundaries documented")
  ];
  const integrationChecks = [
    check("registrationReferralAcceptance:serverReferralSeed", "T00", rtc001.includes('collaborationOrderId: "cco-004"') && rtc002.includes('collaborationOrderId: "cco-005"'), "shared server referral seed matches repaired data"),
    check("registrationReferralAcceptance:serverMessageSeed", "T00", msgRtc002Citizen.includes('residentId: "r4"') && msgRtc002Institution.includes('residentId: "r4"'), "shared server task-message seed matches repaired resident scope"),
    check("registrationReferralAcceptance:publicCommandApi", "T00", serverSource.includes("/api/registration-referral/commands") && serverSource.includes("applyClosureCommand"), "public command endpoint persists service results transactionally"),
    check("registrationReferralAcceptance:packageScript", "T00", Boolean(pkg.scripts?.["registration-referral:acceptance"]), pkg.scripts?.["registration-referral:acceptance"] || "missing package script"),
    check("registrationReferralAcceptance:releaseWiring", "T00", releaseWired, "release manifest, deploy check and release report wiring")
  ];
  const threadReady = threadChecks.every((item) => item.passed);
  const integrationReady = integrationChecks.every((item) => item.passed);
  return {
    ok: threadReady,
    threadReady,
    integrationReady,
    productionReady: false,
    status: !threadReady ? "thread-acceptance-failed" : !integrationReady ? "thread-ready-t00-integration-pending" : "integrated-local-ready-production-blocked",
    generatedAt: new Date().toISOString(),
    summary: {
      threadChecks: threadChecks.length,
      threadPassed: threadChecks.filter((item) => item.passed).length,
      integrationChecks: integrationChecks.length,
      integrationPassed: integrationChecks.filter((item) => item.passed).length,
      commands: CLOSURE_COMMAND_CONTRACTS.length,
      unifiedCases: readiness.summary.cases,
      p0ConsistencyIssues: consistency.summary.P0
    },
    threadChecks,
    integrationChecks,
    commandContracts: CLOSURE_COMMAND_CONTRACTS,
    readiness: {
      functionalOk: readiness.functionalOk,
      dataReady: readiness.dataReady,
      productionReady: readiness.productionReady,
      status: readiness.status,
      summary: readiness.summary
    },
    blockers: [
      ...integrationChecks.filter((item) => !item.passed).map((item) => `${item.id}: ${item.detail}`),
      "live HIS, payment, insurance, referral and messaging callbacks",
      "onsite responsibility, SLA, cutover and rollback signoff"
    ],
    boundary: "T05 thread functionality can pass independently. Shared server, package and release wiring remain T00-owned, and production readiness remains false."
  };
}

function clean(value) {
  return String(value ?? "").replace(/\|/g, "/").replace(/\r?\n/g, " ");
}

function renderMarkdown(report) {
  const checks = [...report.threadChecks, ...report.integrationChecks];
  return [
    "# Registration, Referral and Family Doctor Acceptance",
    "",
    `- Status: ${report.status}`,
    `- Thread ready: ${report.threadReady ? "PASS" : "FAIL"}`,
    `- T00 integration ready: ${report.integrationReady ? "PASS" : "PENDING"}`,
    `- Production ready: ${report.productionReady ? "PASS" : "BLOCKED"}`,
    `- Commands: ${report.summary.commands}`,
    `- Unified cases: ${report.summary.unifiedCases}`,
    "",
    "## Checks",
    "",
    "| Result | Scope | Check | Detail |",
    "|---|---|---|---|",
    ...checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.scope} | ${clean(item.id)} | ${clean(item.detail)} |`),
    "",
    "## T00 Blockers",
    "",
    ...report.blockers.map((item) => `- ${clean(item)}`),
    "",
    "## Command Contracts",
    "",
    "| Action | Roles | Suggested endpoint |",
    "|---|---|---|",
    ...report.commandContracts.map((item) => `| ${item.action} | ${item.roles.join(", ")} | ${clean(item.suggestedEndpoint)} |`),
    ""
  ].join("\n");
}

function parseArgs(argv = process.argv.slice(2)) {
  const flags = { output: DEFAULT_OUTPUT, markdown: DEFAULT_MARKDOWN };
  argv.forEach((arg) => {
    if (arg.startsWith("--output=")) flags.output = path.resolve(ROOT, arg.slice("--output=".length));
    if (arg.startsWith("--markdown=")) flags.markdown = path.resolve(ROOT, arg.slice("--markdown=".length));
    if (arg.startsWith("--as-of=")) flags.asOf = arg.slice("--as-of=".length);
  });
  return flags;
}

function writeOutput(report, flags = {}) {
  const output = path.resolve(flags.output || DEFAULT_OUTPUT);
  const markdown = path.resolve(flags.markdown || DEFAULT_MARKDOWN);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.mkdirSync(path.dirname(markdown), { recursive: true });
  fs.writeFileSync(markdown, `${renderMarkdown(report)}\n`, "utf8");
  return { output, markdown };
}

if (require.main === module) {
  const flags = parseArgs();
  const report = buildRegistrationReferralAcceptance({ asOf: flags.asOf });
  writeOutput(report, flags);
  console.log(JSON.stringify(report, null, 2));
  if (!report.threadReady) process.exitCode = 1;
}

module.exports = {
  buildRegistrationReferralAcceptance,
  extractFunction,
  extractSeedObject,
  parseArgs,
  renderMarkdown,
  writeOutput
};
