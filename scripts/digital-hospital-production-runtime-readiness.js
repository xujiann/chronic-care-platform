const fs = require("node:fs");
const path = require("node:path");
const { readRuntimeSource } = require("../src/http/runtime-source");

const { buildDigitalHospitalSecurityCenter } = require("../digital-hospital-execution-security");
const {
  CUTOVER_EVIDENCE_REQUIREMENTS,
  REQUIRED_APPROVAL_ROLES
} = require("../digital-hospital-cutover-governance");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_JSON = path.join(ROOT, "release", "digital-hospital-production-runtime-readiness-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "digital-hospital-production-runtime-readiness-report.md");

function check(id, passed, detail, severity = "error") {
  return { id, passed: Boolean(passed), detail, severity };
}

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function buildDigitalHospitalProductionRuntimeReadiness(options = {}) {
  const server = readRuntimeSource(ROOT);
  const service = source("digital-hospital-execution-service.js");
  const securitySource = source("digital-hospital-execution-security.js");
  const cutover = source("digital-hospital-cutover-governance.js");
  const openapi = source("digital-hospital-standard-platform/mock-api/openapi.v0.1.yaml");
  const security = buildDigitalHospitalSecurityCenter({
    env: options.env || process.env,
    loaderConfigured: options.loaderConfigured
  });
  const workerFingerprints = String((options.env || process.env).DIGITAL_HOSPITAL_WORKER_MTLS_FINGERPRINTS || "")
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
  const checks = [
    check(
      "runtime:sqlite-transaction",
      /BEGIN IMMEDIATE/.test(service) && /journal_mode = WAL/.test(service),
      "SQLite WAL repository uses an immediate write transaction for atomic claims."
    ),
    check(
      "runtime:lease-token-boundary",
      /leaseTokenHash/.test(source("digital-hospital-integration-execution.js"))
        && /FORBIDDEN_PERSISTED_KEYS/.test(service),
      "Raw lease tokens, idempotency keys, payloads and credentials are blocked from persisted state."
    ),
    check(
      "runtime:server-api",
      [
        "/api/digital-hospital/execution/runtime",
        "/api/digital-hospital/execution/workers",
        "/api/digital-hospital/execution/jobs",
        "/api/digital-hospital/execution/leases/recover-expired",
        "/api/digital-hospital/execution/callbacks",
        "/api/digital-hospital/execution/cutover-evidence-packs"
      ].every((route) => server.includes(route)),
      "Execution, Worker, recovery, callback and cutover evidence APIs are wired into the authenticated server."
    ),
    check(
      "security:managed-key",
      /managed-secret-service/.test(securitySource) && /DIGITAL_HOSPITAL_CALLBACK_KEY_REF/.test(securitySource),
      "Callback verification resolves managed key material transiently from an external reference."
    ),
    check(
      "security:signature-mtls-replay",
      /timingSafeEqual/.test(securitySource)
        && /client certificate fingerprint is not trusted/.test(securitySource)
        && /nonceDigest/.test(securitySource),
      "HMAC, timestamp, nonce digest and mTLS fingerprint checks fail closed."
    ),
    check(
      "cutover:evidence",
      CUTOVER_EVIDENCE_REQUIREMENTS.length === 10
        && /independent verifier/.test(cutover)
        && /raw evidence content/.test(cutover),
      `${CUTOVER_EVIDENCE_REQUIREMENTS.length} digest-only evidence requirements include independent verification.`
    ),
    check(
      "cutover:approvals",
      REQUIRED_APPROVAL_ROLES.length === 4 && /CUTOVER_APPROVAL_INDEPENDENCE_REQUIRED/.test(cutover),
      `${REQUIRED_APPROVAL_ROLES.length} unique approval roles are enforced before a GO decision.`
    ),
    check(
      "contract:openapi",
      /IntegrationExecution/.test(openapi) && /IntegrationCutoverWindow/.test(openapi),
      "Public OpenAPI contains the execution and cutover contract surface."
    )
  ];
  const softwareComplete = checks.filter((item) => item.severity === "error").every((item) => item.passed);
  const externalActivation = {
    managedCallbackKeyReady: security.managedKey.referenceConfigured && security.managedKey.loaderConfigured,
    callbackMtlsReady: security.mtls.trustedFingerprintCount > 0,
    workerMtlsReady: workerFingerprints.length > 0,
    hospitalSiteEvidenceSigned: false,
    productionChangeApproved: false
  };
  const productionReady = softwareComplete && Object.values(externalActivation).every(Boolean);
  return {
    ok: softwareComplete,
    generatedAt: new Date().toISOString(),
    version: "v0.18",
    status: productionReady ? "production-ready" : "software-complete-external-activation-required",
    softwareComplete,
    productionReady,
    checks,
    security,
    externalActivation,
    summary: {
      checks: checks.length,
      passed: checks.filter((item) => item.passed).length,
      apiRoutes: (server.match(/\/api\/digital-hospital\/execution\//g) || []).length,
      evidenceRequirements: CUTOVER_EVIDENCE_REQUIREMENTS.length,
      approvalRoles: REQUIRED_APPROVAL_ROLES.length,
      externalBlockers: Object.values(externalActivation).filter((value) => !value).length
    },
    externalBlockers: [
      ...(!externalActivation.managedCallbackKeyReady ? ["Connect the managed callback key loader and production vault reference."] : []),
      ...(!externalActivation.callbackMtlsReady ? ["Install the trusted callback gateway mTLS certificate fingerprint."] : []),
      ...(!externalActivation.workerMtlsReady ? ["Install the trusted Worker service mTLS certificate fingerprints."] : []),
      ...(!externalActivation.hospitalSiteEvidenceSigned ? ["Archive independently verified hospital joint-test and cutover evidence."] : []),
      ...(!externalActivation.productionChangeApproved ? ["Record the approved production change ticket and four-role cutover decision."] : [])
    ],
    boundary: "Software capability is complete. Production activation remains blocked until external infrastructure and site evidence are configured and signed."
  };
}

function renderMarkdown(report) {
  const lines = [
    "# Digital hospital production runtime readiness",
    "",
    `- Version: ${report.version}`,
    `- Generated at: ${report.generatedAt}`,
    `- Status: ${report.status}`,
    `- Software complete: ${report.softwareComplete ? "yes" : "no"}`,
    `- Production ready: ${report.productionReady ? "yes" : "no"}`,
    "",
    "## Software checks",
    "",
    "| Check | Result | Detail |",
    "| --- | --- | --- |",
    ...report.checks.map((item) => `| ${item.id} | ${item.passed ? "PASS" : "FAIL"} | ${item.detail} |`),
    "",
    "## External activation blockers",
    "",
    ...(report.externalBlockers.length ? report.externalBlockers.map((item) => `- ${item}`) : ["- None"]),
    "",
    `> ${report.boundary}`,
    ""
  ];
  return lines.join("\n");
}

function writeOutput(report, options = {}) {
  const jsonFile = path.resolve(options.jsonFile || DEFAULT_JSON);
  const markdownFile = path.resolve(options.markdownFile || DEFAULT_MARKDOWN);
  fs.mkdirSync(path.dirname(jsonFile), { recursive: true });
  fs.mkdirSync(path.dirname(markdownFile), { recursive: true });
  fs.writeFileSync(jsonFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(markdownFile, renderMarkdown(report), "utf8");
  return { jsonFile, markdownFile };
}

if (require.main === module) {
  const report = buildDigitalHospitalProductionRuntimeReadiness();
  const output = writeOutput(report);
  console.log(JSON.stringify({
    ok: report.ok,
    status: report.status,
    summary: report.summary,
    output
  }, null, 2));
  if (!report.ok) process.exitCode = 1;
}

module.exports = {
  buildDigitalHospitalProductionRuntimeReadiness,
  renderMarkdown,
  writeOutput
};
