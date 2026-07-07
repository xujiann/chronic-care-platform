const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildEscortServiceReadinessReport,
  renderMarkdown,
  writeReport
} = require("../scripts/escort-service-readiness");

test("escort service readiness validates policy, registry, workforce, orders and APIs", () => {
  const report = buildEscortServiceReadinessReport();
  assert.equal(report.ok, true);
  assert.equal(report.boundaries.includes("provider registry"), true);
  assert.equal(report.boundaries.includes("quality monitoring"), true);
  assert.equal(report.summary.providers >= 3, true);
  assert.equal(report.summary.trainedWorkers >= 3, true);
  assert.equal(report.summary.orders >= 3, true);
  assert.equal(report.summary.subsidyOrders >= 1, true);
  assert.equal(report.summary.hospitalConfirmedOrders >= 1, true);
  assert.equal(report.checks.some((item) => item.id === "escort:api" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "escort:hospitalInterface" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "escort:hospitalInterfaceDoc" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "escort:responsibilityPlan" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "escort:launchOwnerChecklist" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "escort:productionBlockers" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "escort:deploymentPlan" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "escort:frontend" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "escort:citizenProviderAvailability" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "escort:citizenProgressTracking" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "escort:citizenSubmitReadiness" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "escort:providerScopeGuard" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "escort:duplicateAppointmentGuard" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "escort:appointmentFieldGuard" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "escort:citizenCancellation" && item.passed), true);
  assert.match(renderMarkdown(report), /Medical escort service readiness report/);
  assert.match(renderMarkdown(report), /Hospital-confirmed orders/);
  assert.match(renderMarkdown(report), /current functions, responsible departments, evidence, and next planned escort development are documented/);
  assert.match(renderMarkdown(report), /go-live owner handoff checklist is visible/);
  assert.match(renderMarkdown(report), /production blockers and on-site external dependencies are visible/);
  assert.match(renderMarkdown(report), /server purchase, shared-platform deployment topology, and live smoke-test setup are documented/);
  assert.match(renderMarkdown(report), /citizen appointment is enabled only when a published provider is available/);
  assert.match(renderMarkdown(report), /resident order cards expose contract, insurance, hospital handoff, service, and callback progress/);
  assert.match(renderMarkdown(report), /visible readiness summary/);
  assert.match(renderMarkdown(report), /order creation rejects missing or unpublished provider registry rows/);
  assert.match(renderMarkdown(report), /open resident escort appointments are idempotency-guarded/);
  assert.match(renderMarkdown(report), /resident escort requests require hospital, department, service items/);
});

test("escort service readiness writes release artifacts", (t) => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "escort-readiness-"));
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const report = buildEscortServiceReadinessReport();
  const output = path.join(outputDir, "escort-service-readiness-report.json");
  const markdown = path.join(outputDir, "escort-service-readiness-report.md");
  writeReport(report, output, markdown);
  const json = JSON.parse(fs.readFileSync(output, "utf8"));
  const md = fs.readFileSync(markdown, "utf8");
  assert.equal(json.ok, true);
  assert.equal(json.escortServiceReadiness.ok, true);
  assert.match(md, /Subsidy orders/);
});
