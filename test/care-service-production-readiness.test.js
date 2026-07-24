const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  buildCareServiceProductionReadiness,
  renderMarkdown,
  writeReport
} = require("../scripts/care-service-production-readiness");
const {
  EVIDENCE_SCHEMA_VERSION,
  REQUIRED_SCOPES,
  sha256
} = require("../care-service-cutover-evidence");
const DependencyEvidence = require("../care-service-dependency-evidence");
const Runtime = require("../care-service-runtime");
const NursingService = require("../internet-nursing-service");

const AT = "2026-07-23T01:00:00.000Z";
const SECRET = "production-secret-material-0123456789abcdef";

function approvedCutoverManifest(overrides = {}) {
  return {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    policyVersion: Runtime.RUNTIME_POLICY_VERSION,
    environment: "production",
    releaseId: "CARE-CHANGE-20260724-001",
    approvals: REQUIRED_SCOPES.map((scope, index) => ({
      scope,
      decision: "approved",
      signerId: `${scope}-approver-001`,
      signedAt: "2026-07-23T00:30:00.000Z",
      expiresAt: "2026-08-23T00:30:00.000Z",
      evidenceRef: `urn:care-cutover:${scope}:20260723`,
      evidenceDigest: `sha256:${String(index + 1).repeat(64)}`
    })),
    ...overrides
  };
}

function withApprovedCutoverEvidence(t, env = productionEnv()) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "care-service-cutover-ready-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const raw = Buffer.from(JSON.stringify(approvedCutoverManifest(), null, 2), "utf8");
  const file = path.join(directory, "cutover-evidence.json");
  fs.writeFileSync(file, raw);
  return {
    ...env,
    CARE_CUTOVER_EVIDENCE_FILE: file,
    CARE_CUTOVER_EVIDENCE_SHA256: sha256(raw)
  };
}

function withHealthyDependencyEvidence(t, env = productionEnv()) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "care-service-dependency-ready-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const manifest = {
    schemaVersion: DependencyEvidence.EVIDENCE_SCHEMA_VERSION,
    policyVersion: Runtime.RUNTIME_POLICY_VERSION,
    environment: "production",
    releaseId: "CARE-CHANGE-20260724-002",
    probes: DependencyEvidence.REQUIRED_DEPENDENCIES.map((dependency, index) => ({
      dependency,
      status: "healthy",
      checkType: "signed-health",
      checkedAt: "2026-07-23T00:55:00.000Z",
      expiresAt: "2026-07-23T01:10:00.000Z",
      targetDigest: DependencyEvidence.targetDigestForDependency(env, dependency),
      receiptRef: `urn:care-probe:${dependency}:20260723`,
      receiptDigest: `sha256:${(index + 1).toString(16).repeat(64)}`
    }))
  };
  const raw = Buffer.from(JSON.stringify(manifest, null, 2), "utf8");
  const file = path.join(directory, "dependency-evidence.json");
  fs.writeFileSync(file, raw);
  return {
    ...env,
    CARE_DEPENDENCY_EVIDENCE_FILE: file,
    CARE_DEPENDENCY_EVIDENCE_SHA256: DependencyEvidence.sha256(raw)
  };
}

function productionEnv(overrides = {}) {
  return {
    NODE_ENV: "production",
    STORAGE_ENGINE: "sqlite",
    SESSION_SECRETS: SECRET,
    INTEGRATION_GATEWAY_SECRET: SECRET,
    OIDC_ISSUER_URL: "https://identity.health.gov.cn",
    OIDC_CLIENT_ID: "care-service",
    OIDC_CLIENT_SECRET: SECRET,
    SMS_GATEWAY_URL: "https://sms.health.gov.cn/messages",
    SMS_TEMPLATE_ID: "care-status-v1",
    SMS_GATEWAY_TOKEN: SECRET,
    SMS_DELIVERY_CALLBACK_SECRET: SECRET,
    HIS_ADAPTER_URL: "https://his.hospital.cn/events",
    HIS_ADAPTER_SECRET: SECRET,
    APPOINTMENT_ADAPTER_URL: "https://appointment.hospital.cn/events",
    APPOINTMENT_ADAPTER_SECRET: SECRET,
    OBJECT_STORAGE_GATEWAY_URL: "https://storage.health.gov.cn",
    OBJECT_STORAGE_BUCKET: "care-evidence",
    OBJECT_STORAGE_SIGNING_SECRET: SECRET,
    PAYMENT_GATEWAY_URL: "https://payment.health.gov.cn",
    PAYMENT_GATEWAY_SECRET: SECRET,
    PAYMENT_CALLBACK_SECRET: SECRET,
    INSURANCE_GATEWAY_URL: "https://insurance.health.gov.cn",
    INSURANCE_GATEWAY_SECRET: SECRET,
    INSURANCE_CALLBACK_SECRET: SECRET,
    CERTIFICATE_GATEWAY_URL: "https://certificate.health.gov.cn",
    CERTIFICATE_GATEWAY_SECRET: SECRET,
    CERTIFICATE_CALLBACK_SECRET: SECRET,
    SIEM_ENDPOINT: "https://siem.health.gov.cn/events",
    CARE_OUTBOX_WORKER_ENABLED: "true",
    CARE_OUTBOX_WORKER_ID: "care-outbox-prod-01",
    CARE_SERVICE_RUNTIME_MODULE: "care-service-production-runtime.js",
    CARE_NURSING_DELIVERY_URL: "https://nursing.health.gov.cn/care/events",
    CARE_ESCORT_DELIVERY_URL: "https://escort.health.gov.cn/care/events",
    CARE_OUTBOX_DELIVERY_SECRET: SECRET,
    CARE_CUTOVER_BUSINESS_SIGNOFF: "signed",
    CARE_CUTOVER_INTERFACE_SIGNOFF: "signed",
    CARE_CUTOVER_SECURITY_SIGNOFF: "signed",
    CARE_CUTOVER_DR_SIGNOFF: "signed",
    CARE_CUTOVER_ONCALL_SIGNOFF: "signed",
    ...overrides
  };
}

test("default report keeps completed code separate from external production blockers", () => {
  const report = buildCareServiceProductionReadiness({
    env: {},
    data: {},
    at: AT
  });
  assert.equal(report.codeReady, true);
  assert.equal(report.platformIntegrated, true);
  assert.equal(report.runtimeReady, false);
  assert.equal(report.signoffsReady, false);
  assert.equal(report.productionReady, false);
  assert.equal(report.formalGoLiveState, "blocked-by-production-configuration-or-health");
  assert.equal(report.summary.codeBlockers, 0);
  assert.equal(report.summary.platformBlockers, 0);
  assert.equal(report.summary.runtimeBlockers > 0, true);
  assert.equal(report.summary.signoffBlockers, 5);
  assert.match(report.boundary, /real production configuration/);
  assert.match(renderMarkdown(report), /Production ready: NO/);
  assert.match(renderMarkdown(report), /Demo values or standalone signed flags must not be used/);
});

test("fully configured environment and healthy queue produce a cutover-ready result", (t) => {
  const report = buildCareServiceProductionReadiness({
    env: withApprovedCutoverEvidence(t, withHealthyDependencyEvidence(t)),
    data: {},
    at: AT,
    platformIntegrated: true
  });
  assert.equal(report.codeReady, true);
  assert.equal(report.platformIntegrated, true);
  assert.equal(report.runtimeReady, true);
  assert.equal(report.signoffsReady, true);
  assert.equal(report.productionReady, true);
  assert.equal(report.formalGoLiveState, "ready-for-production-cutover");
  assert.equal(report.blockers.length, 0);
});

test("standalone signed flags and injected validation cannot bypass the archived cutover evidence gate", (t) => {
  const report = buildCareServiceProductionReadiness({
    env: withHealthyDependencyEvidence(t),
    data: {},
    at: AT,
    platformIntegrated: true,
    cutoverEvidenceValidation: {
      ok: true,
      releaseId: "forged-release",
      requiredScopes: [...REQUIRED_SCOPES],
      approvedScopes: [...REQUIRED_SCOPES],
      errors: []
    }
  });
  assert.equal(report.runtimeReady, true);
  assert.equal(report.signoffsReady, false);
  assert.equal(report.productionReady, false);
  assert.equal(report.formalGoLiveState, "blocked-until-site-evidence-signed");
  assert.equal(report.summary.signoffBlockers, 5);
  assert.equal(report.cutoverEvidence.errors.some((item) => item.code === "CUTOVER_EVIDENCE_DIGEST_MISMATCH"), true);
});

test("injected dependency validation cannot replace the deployment-pinned probe manifest", (t) => {
  const report = buildCareServiceProductionReadiness({
    env: withApprovedCutoverEvidence(t, productionEnv()),
    data: {},
    at: AT,
    platformIntegrated: true,
    dependencyEvidenceValidation: {
      ok: true,
      requiredDependencies: [...DependencyEvidence.REQUIRED_DEPENDENCIES],
      healthyDependencies: [...DependencyEvidence.REQUIRED_DEPENDENCIES],
      errors: []
    }
  });
  assert.equal(report.signoffsReady, true);
  assert.equal(report.runtimeReady, false);
  assert.equal(report.productionReady, false);
  assert.equal(report.dependencyEvidence.healthyDependencies.length, 0);
  assert.equal(report.dependencyEvidence.errors.some((item) => item.code === "CARE_DEPENDENCY_EVIDENCE_DIGEST_MISMATCH"), true);
});

test("fresh probe receipts cannot make placeholder or loopback targets production ready", (t) => {
  const configured = productionEnv({
    OIDC_ISSUER_URL: "https://identity.example.gov.cn",
    SMS_GATEWAY_URL: "https://localhost/messages"
  });
  const report = buildCareServiceProductionReadiness({
    env: withApprovedCutoverEvidence(t, withHealthyDependencyEvidence(t, configured)),
    data: {},
    at: AT,
    platformIntegrated: true
  });
  assert.equal(report.dependencyEvidence.ok, true);
  assert.equal(report.runtimeReady, false);
  assert.equal(report.blockers.some((item) => item.id === "runtime:identity"), true);
  assert.equal(report.blockers.some((item) => item.id === "runtime:sms"), true);
  assert.equal(report.productionReady, false);
});

test("dead letters and insecure endpoints block otherwise complete production configuration", (t) => {
  const event = NursingService.buildOutboxEvent({
    aggregateId: "ino-dead-001",
    eventType: "internet-nursing-order-created",
    occurredAt: AT,
    idempotencyKey: "nursing:ino-dead-001:create",
    payload: { orderId: "ino-dead-001" }
  });
  event.status = "dead-letter";
  event.attempts = 5;
  const report = buildCareServiceProductionReadiness({
    env: withApprovedCutoverEvidence(
      t,
      withHealthyDependencyEvidence(t, productionEnv({ SMS_GATEWAY_URL: "http://insecure.example.org" }))
    ),
    data: { internetNursingOutbox: [event] },
    at: "2026-07-23T01:00:05.000Z",
    platformIntegrated: true
  });
  assert.equal(report.codeReady, true);
  assert.equal(report.runtimeReady, false);
  assert.equal(report.productionReady, false);
  assert.equal(report.blockers.some((item) => item.id === "runtime:sms"), true);
  assert.equal(report.blockers.some((item) => item.id === "runtime:outbox-health"), true);
  assert.equal(report.outboxHealth.summary.deadLetters, 1);
});

test("production readiness writes JSON and Markdown evidence", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "care-service-readiness-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const report = buildCareServiceProductionReadiness({ env: {}, data: {}, at: AT });
  const jsonPath = path.join(directory, "report.json");
  const markdownPath = path.join(directory, "report.md");
  writeReport(report, jsonPath, markdownPath);
  assert.equal(JSON.parse(fs.readFileSync(jsonPath, "utf8")).codeReady, true);
  assert.match(fs.readFileSync(markdownPath, "utf8"), /Outbox health/);
});
