#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "chronic-institution-interfaces.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "chronic-institution-interfaces.md");
const DOC_PATH = "docs/chronic-institution-interfaces.md";

const CONTRACTS = [
  {
    id: "chronic-followup-summary-v1",
    method: "GET",
    path: "/api/chronic/followup-summary",
    owner: "medical-institution",
    direction: "outbound",
    roles: ["commission", "institution", "citizen"],
    requiredFields: ["residentId?", "summary", "alertQueue", "policyAlignment", "residents"],
    targetCollections: ["followups", "chronicManagementPlans", "chronicScreeningTasks", "medicationPickups", "taskMessages"],
    evidence: ["server route", "API regression", "readiness apiSurface"]
  },
  {
    id: "chronic-followup-feedback-v1",
    method: "POST",
    path: "/api/chronic/followup-feedback",
    owner: "citizen-and-institution",
    direction: "inbound",
    roles: ["citizen", "institution", "commission"],
    requiredFields: ["residentId", "followupId?", "feedback|result", "medicationTaken?", "symptoms?", "nextRequest?"],
    targetCollections: ["personalRecords", "followups", "taskMessages", "securityEvents", "dataAccessLogs"],
    evidence: ["resident authorization", "task message", "audit trail"]
  },
  {
    id: "chronic-resident-checkin-v1",
    method: "POST",
    path: "/api/chronic/resident-checkins",
    owner: "resident-service",
    direction: "inbound",
    roles: ["citizen", "institution", "commission"],
    requiredFields: ["residentId", "measurementType?", "measurementValue?", "medicationPickupId?", "medicationTaken?", "satisfaction?", "proxyName?", "seniorReminder?"],
    targetCollections: ["personalRecords", "chronicSelfManagement", "medicationPickups", "seniorServices", "taskMessages"],
    evidence: ["health points", "family proxy", "senior reminder"]
  },
  {
    id: "chronic-device-measurement-v1",
    method: "POST",
    path: "/api/chronic/device-measurements",
    owner: "device-gateway",
    direction: "inbound",
    roles: ["citizen", "institution", "commission"],
    requiredFields: ["residentId", "externalId?", "deviceId?", "deviceType?", "measurementType", "measurementValue", "reportedAt?"],
    targetCollections: ["personalRecords", "chronicSelfManagement", "taskMessages"],
    evidence: ["idempotent externalId", "resident authorization", "review message"]
  },
  {
    id: "chronic-pharmacy-callback-v1",
    method: "POST",
    path: "/api/chronic/pharmacy-callbacks",
    owner: "pharmacy-or-his",
    direction: "inbound",
    roles: ["institution", "insurance", "commission"],
    requiredFields: ["medicationPickupId", "externalId?", "status", "pharmacyStatus?", "medicationTaken?", "pickupConfirmedAt?"],
    targetCollections: ["medicationPickups", "taskMessages", "securityEvents", "dataAccessLogs"],
    evidence: ["pickup status", "citizen message", "institution message closure"]
  },
  {
    id: "chronic-family-doctor-action-v1",
    method: "POST",
    path: "/api/chronic/family-doctor-actions",
    owner: "family-doctor-system",
    direction: "inbound",
    roles: ["institution", "commission"],
    requiredFields: ["residentId", "messageId?", "taskId?", "action", "result", "nextAction?"],
    targetCollections: ["personalRecords", "taskMessages", "securityEvents", "dataAccessLogs"],
    evidence: ["institution message handled", "citizen notice", "personal record"]
  },
  {
    id: "chronic-reminder-outreach-v1",
    method: "POST",
    path: "/api/chronic/reminder-outreach",
    owner: "message-platform",
    direction: "outbound-request",
    roles: ["institution", "commission"],
    requiredFields: ["residentId", "channel", "reminderType", "reason?", "scheduledAt?"],
    targetCollections: ["seniorServices", "taskMessages", "securityEvents", "dataAccessLogs"],
    evidence: ["sms/phone/in-app evidence", "senior service", "receipt-ready task message"]
  },
  {
    id: "chronic-followup-escalation-v1",
    method: "POST",
    path: "/api/chronic/followup-escalations",
    owner: "medical-institution",
    direction: "inbound",
    roles: ["institution", "commission"],
    requiredFields: ["collection|alertId", "id?", "reason?", "escalationOwner?"],
    targetCollections: ["followups", "chronicManagementPlans", "chronicScreeningTasks", "medicationPickups", "taskMessages", "securityEvents", "dataAccessLogs"],
    evidence: ["business item escalation stamp", "institution message", "audit trail"]
  },
  {
    id: "chronic-followup-dispatch-v1",
    method: "POST",
    path: "/api/chronic/followup-dispatch",
    owner: "medical-institution",
    direction: "inbound",
    roles: ["institution", "commission"],
    requiredFields: ["collection", "id", "updates?", "status?", "note?", "resolveEscalation?"],
    targetCollections: ["followups", "chronicManagementPlans", "chronicScreeningTasks", "medicationPickups", "taskMessages"],
    evidence: ["business disposition", "message closure", "escalation closure", "citizen notification"]
  }
];

function readText(relativePath, fallback = "") {
  const fullPath = path.join(ROOT, relativePath);
  return fs.existsSync(fullPath) ? fs.readFileSync(fullPath, "utf8") : fallback;
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function hasAll(text, values) {
  return values.every((value) => text.includes(value));
}

function buildChronicInstitutionInterfaceReport(options = {}) {
  const data = options.data || readJson("data/db.json");
  const pkg = options.pkg || readJson("package.json");
  const doc = options.doc || readText(DOC_PATH);
  const readinessDoc = options.readinessDoc || readText("docs/chronic-followup-readiness.md");
  const server = options.server || readText("server.js");
  const apiTest = options.apiTest || readText("test/api.test.js");
  const staticTest = options.staticTest || readText("test/static.test.js");
  const readinessScript = options.readinessScript || readText("scripts/chronic-followup-readiness.js");

  const contracts = CONTRACTS.map((contract) => {
    const routeReady = server.includes(contract.path);
    const docReady = doc.includes(contract.path) && doc.includes(contract.id);
    const testReady = apiTest.includes(contract.path) || staticTest.includes(contract.path);
    const readinessReady = readinessScript.includes(contract.path) || readinessDoc.includes(contract.path);
    const targetCollectionsReady = contract.targetCollections.every((collection) => Object.prototype.hasOwnProperty.call(data, collection));
    return {
      ...contract,
      routeReady,
      docReady,
      testReady,
      readinessReady,
      targetCollectionsReady,
      ready: routeReady && docReady && testReady && readinessReady && targetCollectionsReady
    };
  });

  const launchEvidence = {
    script: Boolean(pkg.scripts?.["chronic:institution-interfaces"]),
    reportArtifact: /chronic-institution-interfaces/.test(readText("scripts/release-artifact-manifest.js")),
    releaseGate: /chronicFollowup:institutionInterfaces/.test(readText("scripts/release-report.js")),
    authorization: hasAll(server, ["canAccessResident", "appendSecurityEvent", "appendDataAccessLog"]),
    messageClosure: hasAll(server, ["appendChronicFollowupMessage", "closeChronicFollowupMessages"]),
    fieldIntegration: hasAll(readinessScript, ["fieldIntegration", "deviceMeasurementRecords", "pharmacyCallbackRecords", "familyDoctorClosureRecords", "reminderOutreachRecords"]),
    seedEvidence: Boolean(
      (data.chronicSelfManagement || []).some((item) => item.deviceExternalId || item.deviceId) &&
      (data.medicationPickups || []).some((item) => item.callbackExternalId || item.pickupConfirmedAt) &&
      (data.personalRecords || []).some((item) => item.category === "chronic-family-doctor-note" || item.meta?.familyDoctorClosure) &&
      (data.seniorServices || []).some((item) => item.outreachEvidence)
    )
  };
  const checks = [
    { id: "institution-interfaces:contracts", passed: contracts.length === CONTRACTS.length && contracts.every((item) => item.ready), detail: `${contracts.filter((item) => item.ready).length}/${contracts.length} contracts ready` },
    { id: "institution-interfaces:docs", passed: contracts.every((item) => item.docReady), detail: DOC_PATH },
    { id: "institution-interfaces:routes", passed: contracts.every((item) => item.routeReady), detail: contracts.map((item) => `${item.path}:${item.routeReady ? "yes" : "missing"}`).join(";") },
    { id: "institution-interfaces:tests", passed: contracts.every((item) => item.testReady), detail: "api/static coverage" },
    { id: "institution-interfaces:release", passed: launchEvidence.script && launchEvidence.reportArtifact && launchEvidence.releaseGate, detail: "script, manifest, and release gate" },
    { id: "institution-interfaces:launchEvidence", passed: Object.values(launchEvidence).every(Boolean), detail: Object.entries(launchEvidence).map(([key, value]) => `${key}:${value ? "yes" : "no"}`).join(";") }
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    summary: {
      contracts: contracts.length,
      readyContracts: contracts.filter((item) => item.ready).length,
      launchEvidence: Object.values(launchEvidence).filter(Boolean).length,
      launchEvidenceTotal: Object.keys(launchEvidence).length
    },
    contracts,
    launchEvidence,
    checks
  };
}

function renderMarkdown(report) {
  const checkRows = report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${String(item.detail || "").replace(/\|/g, "/")} |`);
  const contractRows = report.contracts.map((item) => `| ${item.ready ? "PASS" : "FAIL"} | ${item.id} | ${item.method} ${item.path} | ${item.owner} | ${item.roles.join(", ")} | ${item.requiredFields.join(", ")} |`);
  return [
    "# Chronic institution interface readiness",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Contracts: ${report.summary.readyContracts}/${report.summary.contracts}`,
    `- Launch evidence: ${report.summary.launchEvidence}/${report.summary.launchEvidenceTotal}`,
    "",
    "## Checks",
    "",
    "| Result | Check | Detail |",
    "|---|---|---|",
    ...checkRows,
    "",
    "## Interface contracts",
    "",
    "| Result | Contract | Endpoint | Owner | Roles | Required fields |",
    "|---|---|---|---|---|---|",
    ...contractRows,
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
  return { output, markdown };
}

if (require.main === module) {
  const flags = parseArgs();
  const report = buildChronicInstitutionInterfaceReport();
  const written = writeOutput(report, flags);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok && !flags.allowFailure) {
    process.exitCode = 1;
  }
  if (flags.printPaths) {
    console.error(`wrote ${written.output}`);
    console.error(`wrote ${written.markdown}`);
  }
}

module.exports = {
  CONTRACTS,
  buildChronicInstitutionInterfaceReport,
  renderMarkdown,
  parseArgs,
  writeOutput
};
