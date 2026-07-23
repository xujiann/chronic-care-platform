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
const NursingService = require("../internet-nursing-service");

const AT = "2026-07-23T01:00:00.000Z";
const SECRET = "production-secret-material-0123456789abcdef";

function productionEnv(overrides = {}) {
  return {
    NODE_ENV: "production",
    STORAGE_ENGINE: "sqlite",
    SESSION_SECRETS: SECRET,
    INTEGRATION_GATEWAY_SECRET: SECRET,
    OIDC_ISSUER_URL: "https://identity.example.gov.cn",
    OIDC_CLIENT_ID: "care-service",
    OIDC_CLIENT_SECRET: SECRET,
    SMS_GATEWAY_URL: "https://sms.example.gov.cn/messages",
    SMS_TEMPLATE_ID: "care-status-v1",
    SMS_GATEWAY_TOKEN: SECRET,
    SMS_DELIVERY_CALLBACK_SECRET: SECRET,
    HIS_ADAPTER_URL: "https://his.example.org/events",
    HIS_ADAPTER_SECRET: SECRET,
    APPOINTMENT_ADAPTER_URL: "https://appointment.example.org/events",
    APPOINTMENT_ADAPTER_SECRET: SECRET,
    OBJECT_STORAGE_GATEWAY_URL: "https://storage.example.gov.cn",
    OBJECT_STORAGE_BUCKET: "care-evidence",
    OBJECT_STORAGE_SIGNING_SECRET: SECRET,
    PAYMENT_GATEWAY_URL: "https://payment.example.gov.cn",
    PAYMENT_GATEWAY_SECRET: SECRET,
    PAYMENT_CALLBACK_SECRET: SECRET,
    INSURANCE_GATEWAY_URL: "https://insurance.example.gov.cn",
    INSURANCE_GATEWAY_SECRET: SECRET,
    INSURANCE_CALLBACK_SECRET: SECRET,
    CERTIFICATE_GATEWAY_URL: "https://certificate.example.gov.cn",
    CERTIFICATE_GATEWAY_SECRET: SECRET,
    CERTIFICATE_CALLBACK_SECRET: SECRET,
    SIEM_ENDPOINT: "https://siem.example.gov.cn/events",
    CARE_OUTBOX_WORKER_ENABLED: "true",
    CARE_OUTBOX_WORKER_ID: "care-outbox-prod-01",
    CARE_SERVICE_RUNTIME_MODULE: "care-service-production-runtime.js",
    CARE_NURSING_DELIVERY_URL: "https://care.example.gov.cn/nursing/events",
    CARE_ESCORT_DELIVERY_URL: "https://care.example.gov.cn/escort/events",
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
  assert.match(renderMarkdown(report), /Demo values must not be used/);
});

test("fully configured environment and healthy queue produce a cutover-ready result", () => {
  const report = buildCareServiceProductionReadiness({
    env: productionEnv(),
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

test("dead letters and insecure endpoints block otherwise complete production configuration", () => {
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
    env: productionEnv({ SMS_GATEWAY_URL: "http://insecure.example.org" }),
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
