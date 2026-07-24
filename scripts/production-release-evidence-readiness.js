#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_EVIDENCE_DIR = path.join(ROOT, "evidence", "production-security-release");

const GATE_DEFINITIONS = [
  {
    id: "security-assessment",
    file: "security-assessment.json",
    gateId: "P0-07",
    owner: "security-compliance",
    environment: "production",
    externalDependencies: ["classified-protection assessor", "commercial-crypto assessor", "penetration-test provider"]
  },
  {
    id: "monitoring-drill",
    file: "monitoring-drill.json",
    gateId: "P0-09",
    owner: "platform-ops",
    environment: "production",
    externalDependencies: ["SIEM or webhook receiver", "on-call and ticketing platform"]
  },
  {
    id: "dr-rehearsal",
    file: "dr-rehearsal.json",
    gateId: "P0-10-DR",
    owner: "data-platform",
    environment: "disaster-recovery",
    externalDependencies: ["database backup service", "off-site replica", "infrastructure operations"]
  },
  {
    id: "site-acceptance",
    file: "site-acceptance.json",
    gateId: "P0-SITE-ACCEPTANCE",
    owner: "project-office",
    environment: "production",
    externalDependencies: ["pilot hospital", "upstream agencies", "interface providers"]
  },
  {
    id: "go-no-go",
    file: "go-no-go.json",
    gateId: "P0-10-GLOBAL",
    owner: "cutover-committee",
    environment: "production",
    externalDependencies: ["change advisory board", "hospital authorization", "four-party signers"]
  }
];

const REQUIRED_P0_TASKS = Array.from({ length: 10 }, (_, index) => `P0-${String(index + 1).padStart(2, "0")}`);
const FOUR_PARTY_ROLES = ["business", "information", "operations", "security"];
const MONITORING_SIGNOFF_ROLES = ["business", "project", "operations", "security"];
const REQUIRED_GO_PREREQUISITES = ["siteAcceptances", "securityOpinion", "launchSmoke", "cutoverChecklist", "drSignoff"];

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function createEvidenceFingerprint(records = {}) {
  const controlled = GATE_DEFINITIONS
    .filter((item) => item.id !== "go-no-go")
    .map((item) => [item.file, records[item.file] || null]);
  return createHash("sha256").update(stableStringify(controlled)).digest("hex");
}

function check(id, passed, detail) {
  return { id, passed: Boolean(passed), detail: String(detail || "") };
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isIsoDate(value) {
  return typeof value === "string" && value.trim() !== "" && !Number.isNaN(Date.parse(value));
}

function isSha256(value, prefixed = true) {
  const pattern = prefixed ? /^sha256:[a-f0-9]{64}$/i : /^[a-f0-9]{64}$/i;
  return pattern.test(String(value || ""));
}

function isControlledReference(value) {
  return /^(controlled|evidence|archive):\/\/[A-Za-z0-9._~!$&'()*+,;=:@/?%-]+$/.test(String(value || ""));
}

function hasPlaceholder(value) {
  if (typeof value === "string") return /<[^>]+>|\b(?:TBD|TODO|replace-with|pending-value)\b/i.test(value);
  if (Array.isArray(value)) return value.some(hasPlaceholder);
  if (isObject(value)) return Object.values(value).some(hasPlaceholder);
  return false;
}

function findSensitiveMaterial(value, currentPath = "$") {
  const findings = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => findings.push(...findSensitiveMaterial(item, `${currentPath}[${index}]`)));
    return findings;
  }
  if (!isObject(value)) {
    if (typeof value === "string" && (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(value) || /(?:password|secret|token)\s*[=:]\s*[^\s]+/i.test(value))) {
      findings.push(currentPath);
    }
    return findings;
  }
  Object.entries(value).forEach(([key, item]) => {
    const itemPath = `${currentPath}.${key}`;
    const sensitiveKey = /(?:^|_)(?:password|secret|token|privatekey|private_key|credential|keyvalue|key_value)$/i.test(key);
    if (sensitiveKey && typeof item === "string" && item.trim()) findings.push(itemPath);
    findings.push(...findSensitiveMaterial(item, itemPath));
  });
  return findings;
}

function uniqueAccounts(rows) {
  const accounts = (Array.isArray(rows) ? rows : []).map((item) => String(item?.account || "").trim()).filter(Boolean);
  return { accounts, unique: new Set(accounts).size === accounts.length };
}

function rolesComplete(rows, roles) {
  const current = new Set((Array.isArray(rows) ? rows : []).map((item) => item?.role));
  return rows?.length === roles.length && roles.every((role) => current.has(role));
}

function commonChecks(definition, record) {
  if (!isObject(record)) return [check(`evidence:${definition.id}:document`, false, `${definition.file} is missing or invalid` )];
  const attachments = Array.isArray(record.attachments) ? record.attachments : [];
  const steps = Array.isArray(record.steps) ? record.steps : [];
  const sensitive = findSensitiveMaterial(record);
  return [
    check(`evidence:${definition.id}:identity`, /^[A-Za-z0-9][A-Za-z0-9._-]{5,}$/.test(String(record.evidenceId || "")) && record.gateId === definition.gateId, `${record.evidenceId || "missing evidenceId"}; gate ${record.gateId || "missing"}`),
    check(`evidence:${definition.id}:environment`, record.environment === definition.environment, `${record.environment || "missing"}; expected ${definition.environment}`),
    check(`evidence:${definition.id}:ownership`, Boolean(record.ownerDepartment && record.independentVerifier && record.ownerDepartment !== record.independentVerifier), `${record.ownerDepartment || "missing owner"} / ${record.independentVerifier || "missing verifier"}`),
    check(`evidence:${definition.id}:release`, Boolean(record.releaseId && isSha256(record.artifactDigest) && record.changeTicket), `${record.releaseId || "missing release"}; ${record.changeTicket || "missing change ticket"}`),
    check(`evidence:${definition.id}:execution`, isIsoDate(record.executedAt) && Boolean(record.target) && steps.length > 0 && steps.every((item) => typeof item === "string" && item.trim()), `${record.executedAt || "missing time"}; ${steps.length} steps`),
    check(`evidence:${definition.id}:result`, record.result === "passed" && Boolean(record.expectedResult) && Boolean(record.actualResult), record.result || "missing result"),
    check(`evidence:${definition.id}:attachments`, attachments.length > 0 && attachments.every((item) => isControlledReference(item?.reference) && isSha256(item?.digest)), `${attachments.length} controlled attachments`),
    check(`evidence:${definition.id}:dataBoundary`, record.dataBoundary?.containsPatientData === false && record.dataBoundary?.containsSecretValues === false, `patientData=${record.dataBoundary?.containsPatientData}; secretValues=${record.dataBoundary?.containsSecretValues}`),
    check(`evidence:${definition.id}:secretScan`, sensitive.length === 0, sensitive.length ? sensitive.join(", ") : "no embedded secret or private-key material"),
    check(`evidence:${definition.id}:placeholders`, !hasPlaceholder(record), hasPlaceholder(record) ? "placeholder values remain" : "no placeholder values")
  ];
}

function securityChecks(record = {}) {
  const assessments = Array.isArray(record.assessments) ? record.assessments : [];
  const required = ["classified-protection", "commercial-crypto", "penetration-test"];
  const assessmentIds = new Set(assessments.filter((item) => item.status === "accepted" && isControlledReference(item.reportRef)).map((item) => item.id));
  const opinions = Array.isArray(record.securityOpinions) ? record.securityOpinions : [];
  const signers = uniqueAccounts(opinions);
  return [
    check("evidence:security-assessment:formalReports", assessments.length >= required.length && required.every((id) => assessmentIds.has(id)), `${assessmentIds.size}/${required.length} accepted formal reports`),
    check("evidence:security-assessment:findings", Number(record.findings?.openCritical) === 0 && Number(record.findings?.openHigh) === 0, `critical=${record.findings?.openCritical}; high=${record.findings?.openHigh}`),
    check("evidence:security-assessment:opinions", opinions.length === 2 && signers.unique && opinions.every((item) => item.status === "approved" && isControlledReference(item.evidenceRef)), `${signers.accounts.length}/2 independent opinions`)
  ];
}

function monitoringChecks(record = {}) {
  const routes = Array.isArray(record.alertRoutes) ? record.alertRoutes : [];
  const scenarios = Array.isArray(record.drillScenarios) ? record.drillScenarios : [];
  const requiredScenarios = ["delivery", "retry", "escalation", "recovery"];
  const passed = new Set(scenarios.filter((item) => item.passed === true && isControlledReference(item.receiptRef)).map((item) => item.id));
  const signoffs = Array.isArray(record.signoffs) ? record.signoffs : [];
  const signers = uniqueAccounts(signoffs);
  let endpointReady = false;
  try {
    const endpoint = new URL(String(record.productionEndpoint || ""));
    endpointReady = endpoint.protocol === "https:" && !new Set(["localhost", "127.0.0.1", "::1"]).has(endpoint.hostname.toLowerCase());
  } catch {}
  return [
    check("evidence:monitoring-drill:endpoint", endpointReady, record.productionEndpoint || "missing production HTTPS endpoint"),
    check("evidence:monitoring-drill:routes", routes.length > 0 && routes.every((item) => item.status === "verified" && isControlledReference(item.receiptRef)), `${routes.filter((item) => item.status === "verified").length}/${routes.length || 1} verified routes`),
    check("evidence:monitoring-drill:scenarios", requiredScenarios.every((id) => passed.has(id)), `${passed.size}/${requiredScenarios.length} drill scenarios`),
    check("evidence:monitoring-drill:onCall", isControlledReference(record.onCall?.rosterRef) && isControlledReference(record.onCall?.escalationRef), "roster and escalation references required"),
    check("evidence:monitoring-drill:signoff", rolesComplete(signoffs, MONITORING_SIGNOFF_ROLES) && signers.unique, `${signers.accounts.length}/${MONITORING_SIGNOFF_ROLES.length} unique signers`)
  ];
}

function drChecks(record = {}) {
  const scenarios = Array.isArray(record.rehearsalScenarios) ? record.rehearsalScenarios : [];
  const required = ["backup", "restore", "failover", "rollback"];
  const passed = new Set(scenarios.filter((item) => item.passed === true && isControlledReference(item.receiptRef)).map((item) => item.id));
  const rpoTarget = Number(record.objectives?.rpoMinutes);
  const rtoTarget = Number(record.objectives?.rtoMinutes);
  const rpoActual = Number(record.measurements?.rpoMinutes);
  const rtoActual = Number(record.measurements?.rtoMinutes);
  const signoffs = Array.isArray(record.signoffs) ? record.signoffs : [];
  const signers = uniqueAccounts(signoffs);
  return [
    check("evidence:dr-rehearsal:objectives", rpoTarget > 0 && rtoTarget > 0 && rpoActual >= 0 && rtoActual >= 0 && rpoActual <= rpoTarget && rtoActual <= rtoTarget, `RPO ${rpoActual}/${rpoTarget}m; RTO ${rtoActual}/${rtoTarget}m`),
    check("evidence:dr-rehearsal:scenarios", required.every((id) => passed.has(id)), `${passed.size}/${required.length} rehearsal scenarios`),
    check("evidence:dr-rehearsal:offsite", isControlledReference(record.offsiteReplicaRef) && isControlledReference(record.nativeBackupRef), "native backup and off-site replica references required"),
    check("evidence:dr-rehearsal:signoff", rolesComplete(signoffs, FOUR_PARTY_ROLES) && signers.unique, `${signers.accounts.length}/${FOUR_PARTY_ROLES.length} unique signers`)
  ];
}

function siteAcceptanceChecks(record = {}) {
  const tasks = Array.isArray(record.tasks) ? record.tasks : [];
  const taskIds = new Set(tasks.filter((item) => item.status === "site-accepted" && isControlledReference(item.evidenceRef)).map((item) => item.id));
  const signaturesComplete = tasks.every((item) => {
    const signers = uniqueAccounts(item.signatures);
    return rolesComplete(item.signatures, FOUR_PARTY_ROLES) && signers.unique;
  });
  return [
    check("evidence:site-acceptance:tasks", tasks.length === REQUIRED_P0_TASKS.length && REQUIRED_P0_TASKS.every((id) => taskIds.has(id)), `${taskIds.size}/${REQUIRED_P0_TASKS.length} site-accepted tasks`),
    check("evidence:site-acceptance:signatures", tasks.length === REQUIRED_P0_TASKS.length && signaturesComplete, signaturesComplete ? "four-party signatures complete for every task" : "missing or duplicate task signatures")
  ];
}

function goNoGoChecks(record = {}, fingerprint) {
  const prerequisites = Array.isArray(record.prerequisites) ? record.prerequisites : [];
  const passed = new Set(prerequisites.filter((item) => item.passed === true && isControlledReference(item.evidenceRef)).map((item) => item.id));
  const approvals = Array.isArray(record.approvals) ? record.approvals : [];
  const signers = uniqueAccounts(approvals);
  const decisionActor = String(record.decision?.account || "").trim();
  return [
    check("evidence:go-no-go:prerequisites", REQUIRED_GO_PREREQUISITES.every((id) => passed.has(id)), `${passed.size}/${REQUIRED_GO_PREREQUISITES.length} current prerequisites`),
    check("evidence:go-no-go:approvals", rolesComplete(approvals, FOUR_PARTY_ROLES) && signers.unique && approvals.every((item) => item.status === "approved" && isControlledReference(item.evidenceRef)), `${signers.accounts.length}/${FOUR_PARTY_ROLES.length} unique approvals`),
    check("evidence:go-no-go:fingerprint", isSha256(record.evidenceFingerprint, false) && record.evidenceFingerprint === fingerprint, record.evidenceFingerprint === fingerprint ? "current evidence fingerprint" : "evidence drift detected"),
    check("evidence:go-no-go:decision", record.decision?.value === "GO" && record.decision?.confirmation === "APPROVE PRODUCTION GO LIVE" && Boolean(decisionActor) && !signers.accounts.includes(decisionActor) && Boolean(record.decision?.rollbackOwner), `${record.decision?.value || "missing"}; decision owner ${decisionActor || "missing"}`)
  ];
}

function readEvidenceDirectory(directory = DEFAULT_EVIDENCE_DIR) {
  const resolved = path.resolve(directory);
  const records = {};
  GATE_DEFINITIONS.forEach((definition) => {
    const file = path.join(resolved, definition.file);
    if (!fs.existsSync(file)) return;
    try {
      records[definition.file] = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      records[definition.file] = { __parseError: error.message };
    }
  });
  return { directory: resolved, records };
}

function buildProductionReleaseEvidenceReadiness(options = {}) {
  const loaded = options.records
    ? { directory: path.resolve(options.directory || DEFAULT_EVIDENCE_DIR), records: options.records }
    : readEvidenceDirectory(options.directory || DEFAULT_EVIDENCE_DIR);
  const fingerprint = createEvidenceFingerprint(loaded.records);
  const checks = [];
  GATE_DEFINITIONS.forEach((definition) => {
    const record = loaded.records[definition.file];
    checks.push(...commonChecks(definition, record));
    if (!isObject(record) || record.__parseError) return;
    if (definition.id === "security-assessment") checks.push(...securityChecks(record));
    if (definition.id === "monitoring-drill") checks.push(...monitoringChecks(record));
    if (definition.id === "dr-rehearsal") checks.push(...drChecks(record));
    if (definition.id === "site-acceptance") checks.push(...siteAcceptanceChecks(record));
    if (definition.id === "go-no-go") checks.push(...goNoGoChecks(record, fingerprint));
  });
  const present = GATE_DEFINITIONS.filter((item) => isObject(loaded.records[item.file]) && !loaded.records[item.file].__parseError).length;
  const ok = checks.length > 0 && checks.every((item) => item.passed);
  return {
    ok,
    generatedAt: new Date().toISOString(),
    status: ok ? "go-decision-evidence-validated" : "no-go-evidence-incomplete",
    evidenceDirectory: loaded.directory,
    evidenceFingerprint: fingerprint,
    summary: {
      documents: GATE_DEFINITIONS.length,
      present,
      checks: checks.length,
      passed: checks.filter((item) => item.passed).length,
      failed: checks.filter((item) => !item.passed).length
    },
    gates: GATE_DEFINITIONS.map((item) => ({ ...item, present: isObject(loaded.records[item.file]) && !loaded.records[item.file].__parseError })),
    checks,
    boundary: "This validator checks minimized evidence structure, controlled references, independent signatures and evidence drift. It does not inspect secret values, execute deployment, certify an assessment, sign hospital acceptance or authorize production cutover."
  };
}

function clean(value) {
  return String(value ?? "").replace(/\|/g, "/").replace(/\r?\n/g, " ");
}

function renderMarkdown(report) {
  return [
    "# Production security release evidence readiness", "",
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "NO-GO"}`,
    `- Status: ${report.status}`,
    `- Evidence documents: ${report.summary.present}/${report.summary.documents}`,
    `- Checks: ${report.summary.passed}/${report.summary.checks}`,
    `- Evidence fingerprint: ${report.evidenceFingerprint}`, "",
    "## Gate responsibility", "",
    "| Gate | File | Environment | Owner | External dependencies | Present |",
    "|---|---|---|---|---|---|",
    ...report.gates.map((item) => `| ${item.gateId} | ${item.file} | ${item.environment} | ${item.owner} | ${clean(item.externalDependencies.join(", "))} | ${item.present ? "yes" : "no"} |`), "",
    "## Checks", "",
    "| Result | Check | Detail |", "|---|---|---|",
    ...report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${clean(item.detail)} |`), "",
    "## Production boundary", "", report.boundary, ""
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
  if (flags.output) {
    const output = path.resolve(ROOT, String(flags.output));
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(report, null, 2), "utf8");
  }
  if (flags.markdown) {
    const markdown = path.resolve(ROOT, String(flags.markdown));
    fs.mkdirSync(path.dirname(markdown), { recursive: true });
    fs.writeFileSync(markdown, renderMarkdown(report), "utf8");
  }
}

function runCli() {
  const flags = parseArgs();
  const report = buildProductionReleaseEvidenceReadiness({ directory: flags["evidence-dir"] || DEFAULT_EVIDENCE_DIR });
  writeOutput(report, flags);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
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
  DEFAULT_EVIDENCE_DIR,
  FOUR_PARTY_ROLES,
  GATE_DEFINITIONS,
  MONITORING_SIGNOFF_ROLES,
  REQUIRED_GO_PREREQUISITES,
  REQUIRED_P0_TASKS,
  buildProductionReleaseEvidenceReadiness,
  createEvidenceFingerprint,
  findSensitiveMaterial,
  parseArgs,
  readEvidenceDirectory,
  renderMarkdown,
  writeOutput
};
