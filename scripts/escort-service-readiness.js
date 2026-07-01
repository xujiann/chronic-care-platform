#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "escort-service-readiness-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "escort-service-readiness-report.md");

const REQUIRED_POLICY_FIELDS = ["service catalog", "trained escort workers", "provider registry", "pricing and subsidy", "risk control", "quality monitoring"];
const REQUIRED_ORDER_FIELDS = ["contractStatus", "insuranceStatus", "qualityReview", "subsidyType", "riskLevel", "auditTrail"];
const REQUIRED_HOSPITAL_FIELDS = ["hospitalCode", "hospitalInterfaceStatus", "hospitalCheckInStatus", "hospitalCheckInNo", "hospitalDepartmentContact", "hospitalNotice", "hisVisitId", "appointmentSource", "departmentCode", "doctorCode", "outpatientQueueNo"];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function buildEscortServiceReadinessReport(options = {}) {
  const data = options.data ?? readJson("data/db.json");
  const pkg = options.pkg ?? readJson("package.json");
  const server = options.server ?? readText("server.js");
  const frontend = options.frontend ?? readText("escort.html") + readText("escort.js");
  const citizenFrontend = options.citizenFrontend ?? readText("citizen.html") + readText("citizen.js");
  const hospitalInterfaceDoc = options.hospitalInterfaceDoc ?? readText("docs/escort-hospital-interface.md");
  const policy = data.escortServicePolicy || {};
  const providers = Array.isArray(data.escortServiceProviders) ? data.escortServiceProviders : [];
  const workers = Array.isArray(data.escortWorkers) ? data.escortWorkers : [];
  const orders = Array.isArray(data.escortServiceOrders) ? data.escortServiceOrders : [];
  const providerIds = new Set(providers.map((item) => item.id));
  const workerIds = new Set(workers.map((item) => item.id));
  const checks = [
    { id: "escort:policy", passed: REQUIRED_POLICY_FIELDS.every((item) => (policy.scope || []).includes(item)), detail: (policy.scope || []).join(", ") },
    { id: "escort:providerRegistry", passed: providers.length >= 3 && providers.some((item) => item.published) && providers.every((item) => item.insurance && item.emergencyPlan), detail: `${providers.length} providers` },
    { id: "escort:workerTraining", passed: workers.length >= 4 && workers.filter((item) => item.examStatus === "passed").length >= 3 && workers.every((item) => item.trainingHours && item.insuranceStatus), detail: `${workers.filter((item) => item.examStatus === "passed").length}/${workers.length} passed` },
    { id: "escort:orders", passed: orders.length >= 3 && orders.every((item) => providerIds.has(item.providerId) && (!item.workerId || workerIds.has(item.workerId))), detail: `${orders.length} orders` },
    { id: "escort:orderEvidence", passed: orders.every((item) => REQUIRED_ORDER_FIELDS.every((field) => Object.hasOwn(item, field))), detail: REQUIRED_ORDER_FIELDS.join(", ") },
    { id: "escort:subsidy", passed: orders.some((item) => ["low-income", "80plus-living-alone", "time-bank"].includes(item.subsidyType)), detail: orders.map((item) => item.subsidyType).join(", ") },
    { id: "escort:riskQuality", passed: orders.some((item) => item.riskLevel === "high") && orders.some((item) => item.qualityReview && item.qualityReview !== "closed"), detail: "risk queue and quality callback present" },
    { id: "escort:api", passed: /\/api\/escort-services\/dashboard/.test(server) && /\/api\/escort-services\/orders/.test(server) && /canAccessEscortOrder/.test(server), detail: "dashboard, order creation, action, and role guard present" },
    { id: "escort:hospitalInterface", passed: /hospital-handoff/.test(server) && /applyEscortHospitalHandoff/.test(server) && REQUIRED_HOSPITAL_FIELDS.every((field) => server.includes(field)) && (orders.some((item) => item.hospitalInterfaceStatus === "confirmed") || server.includes('hospitalInterfaceStatus: "confirmed"')), detail: REQUIRED_HOSPITAL_FIELDS.join(", ") },
    { id: "escort:hospitalInterfaceDoc", passed: /POST \/api\/escort-services\/orders\/:id\/hospital-handoff/.test(hospitalInterfaceDoc) && /flowchart TD/.test(hospitalInterfaceDoc) && /hospitalCode/.test(hospitalInterfaceDoc) && /hisVisitId/.test(hospitalInterfaceDoc) && /outpatientQueueNo/.test(hospitalInterfaceDoc), detail: "hospital handoff contract and workflow documented" },
    { id: "escort:frontend", passed: /escort-order-form/.test(frontend) && /fetchEscortDashboard/.test(frontend) && /data-escort-action/.test(frontend) && /data-escort-hospital/.test(frontend) && /hospital-handoff/.test(frontend), detail: "runnable escort portal and hospital handoff controls present" },
    { id: "escort:citizenAppointment", passed: /escort-appointment-form/.test(citizenFrontend) && /bindEscortAppointment/.test(citizenFrontend) && /\/escort-services\/orders/.test(citizenFrontend) && /formatEscortHospitalHandoff/.test(citizenFrontend), detail: "citizen portal can create and inspect medical escort appointments" },
    { id: "escort:citizenProviderAvailability", passed: /setEscortAppointmentAvailability/.test(citizenFrontend) && /escortProviderReady/.test(citizenFrontend) && /暂无可预约服务主体/.test(citizenFrontend) && /published !== false/.test(citizenFrontend) && /provider is not published/.test(server), detail: "citizen appointment is enabled only when a published provider is available" },
    { id: "escort:providerScopeGuard", passed: /provider not found/.test(server) && /provider is not published/.test(server) && /const provider = \(data\.escortServiceProviders \|\| \[\]\)\.find/.test(server), detail: "order creation rejects missing or unpublished provider registry rows" },
    { id: "escort:duplicateAppointmentGuard", passed: /findDuplicateActiveEscortAppointment/.test(server) && /duplicate active escort appointment/.test(server) && /409/.test(server), detail: "open resident escort appointments are idempotency-guarded by registration or visit slot" },
    { id: "escort:citizenCancellation", passed: /cancel-request/.test(server) && /familyContactStatus = "cancel-requested"/.test(citizenFrontend) && /RESIDENT_TASK_CLOSED_STATUSES/.test(citizenFrontend) && /cancel-requested/.test(citizenFrontend), detail: "resident cancellation closes reminder cards and keeps order history" },
    { id: "escort:releaseScript", passed: Boolean(pkg.scripts?.["escort:readiness"]), detail: pkg.scripts?.["escort:readiness"] || "missing" }
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    policyId: policy.id || "",
    boundaries: REQUIRED_POLICY_FIELDS,
    summary: {
      providers: providers.length,
      publishedProviders: providers.filter((item) => item.published).length,
      workers: workers.length,
      trainedWorkers: workers.filter((item) => item.examStatus === "passed").length,
      orders: orders.length,
      subsidyOrders: orders.filter((item) => item.subsidyType && item.subsidyType !== "self-pay").length,
      highRiskOrders: orders.filter((item) => item.riskLevel === "high" || item.priority === "high").length,
      hospitalConfirmedOrders: orders.filter((item) => item.hospitalInterfaceStatus === "confirmed").length
    },
    checks
  };
}

function renderMarkdown(report) {
  return [
    "# Medical escort service readiness report",
    "",
    `Generated at: ${report.generatedAt}`,
    `Result: ${report.ok ? "PASS" : "FAIL"}`,
    "",
    "## Summary",
    "",
    `- Providers: ${report.summary.providers}`,
    `- Trained workers: ${report.summary.trainedWorkers}/${report.summary.workers}`,
    `- Orders: ${report.summary.orders}`,
    `- Subsidy orders: ${report.summary.subsidyOrders}`,
    `- High-risk orders: ${report.summary.highRiskOrders}`,
    `- Hospital-confirmed orders: ${report.summary.hospitalConfirmedOrders}`,
    "",
    "## Checks",
    "",
    "| Status | Check | Detail |",
    "| --- | --- | --- |",
    ...report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${String(item.detail || "").replace(/\|/g, "/")} |`)
  ].join("\n");
}

function writeReport(report, output = DEFAULT_OUTPUT, markdown = DEFAULT_MARKDOWN) {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({ ok: report.ok, escortServiceReadiness: report }, null, 2), "utf8");
  fs.writeFileSync(markdown, renderMarkdown(report), "utf8");
}

function main() {
  const report = buildEscortServiceReadinessReport();
  writeReport(report);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}

if (require.main === module) main();

module.exports = {
  buildEscortServiceReadinessReport,
  renderMarkdown,
  writeReport
};
