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
  const responsibilityDoc = options.responsibilityDoc ?? readText("docs/陪诊信息平台功能责任与下一步计划.md");
  const deploymentDoc = options.deploymentDoc ?? readText("docs/陪诊服务上线服务器采购与部署方案.md");
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
    { id: "escort:responsibilityPlan", passed: /data-escort-responsibility-plan/.test(frontend) && /功能责任与下一步计划/.test(frontend) && /老龄健康服务部门/.test(responsibilityDoc) && /医疗机构门诊部/.test(responsibilityDoc) && /下一步计划开发功能/.test(responsibilityDoc) && /陪诊师移动端签到/.test(responsibilityDoc) && /补贴结算/.test(responsibilityDoc), detail: "current functions, responsible departments, evidence, and next planned escort development are documented" },
    { id: "escort:launchOwnerChecklist", passed: /data-escort-launch-owner-checklist/.test(frontend) && /规划信息\/运维安全部门/.test(frontend) && /现场移交清单/.test(responsibilityDoc) && /生产域名\/HTTPS/.test(responsibilityDoc) && /HIS\/导诊台联调/.test(responsibilityDoc) && /灰度试点签字|宣教签到/.test(responsibilityDoc), detail: "go-live owner handoff checklist is visible on the escort portal and documented with acceptance evidence" },
    { id: "escort:productionBlockers", passed: /data-escort-production-blockers/.test(frontend) && /统一身份与实名核验/.test(frontend) && /短信与订阅消息通道/.test(frontend) && /HIS\/导诊台联调/.test(frontend) && /合同保险与补贴结算/.test(frontend) && /监控审计与值守/.test(frontend) && /生产上线阻断项/.test(responsibilityDoc) && /电子健康卡授权 scope/.test(responsibilityDoc) && /SIEM endpoint/.test(responsibilityDoc), detail: "production blockers and on-site external dependencies are visible before go-live" },
    { id: "escort:deploymentPlan", passed: /不建议作为第一阶段单独购买服务器/.test(deploymentDoc) && /server\.js/.test(deploymentDoc) && /2 vCPU \/ 4 GiB/.test(deploymentDoc) && /云服务器/.test(deploymentDoc) && /域名与 HTTPS/.test(deploymentDoc) && /托管数据库/.test(deploymentDoc) && /对象存储/.test(deploymentDoc) && /launch:smoke -- --base-url/.test(deploymentDoc) && /陪诊服务上线服务器采购与部署方案/.test(responsibilityDoc), detail: "server purchase, shared-platform deployment topology, and live smoke-test setup are documented" },
    { id: "escort:frontend", passed: /escort-order-form/.test(frontend) && /fetchEscortDashboard/.test(frontend) && /data-escort-action/.test(frontend) && /data-escort-hospital/.test(frontend) && /hospital-handoff/.test(frontend), detail: "runnable escort portal and hospital handoff controls present" },
    { id: "escort:citizenAppointment", passed: /escort-appointment-form/.test(citizenFrontend) && /bindEscortAppointment/.test(citizenFrontend) && /\/escort-services\/orders/.test(citizenFrontend) && /formatEscortHospitalHandoff/.test(citizenFrontend), detail: "citizen portal can create and inspect medical escort appointments" },
    { id: "escort:citizenProgressTracking", passed: /renderEscortOrderProgress/.test(citizenFrontend) && /escort-order-progress/.test(citizenFrontend) && /hospitalInterfaceStatus/.test(citizenFrontend) && /qualityReview/.test(citizenFrontend) && /陪诊订单闭环进度/.test(citizenFrontend), detail: "resident order cards expose contract, insurance, hospital handoff, service, and callback progress" },
    { id: "escort:citizenSubmitReadiness", passed: /buildEscortAppointmentValidation/.test(citizenFrontend) && /escort-appointment-gates/.test(citizenFrontend) && /escort-appointment-gate-summary/.test(citizenFrontend) && /appointmentAt >= todayOffset\(0\)/.test(citizenFrontend) && /请补齐/.test(citizenFrontend), detail: "resident appointment confirmation blocks incomplete provider, hospital, department, date, and service selections with visible readiness summary" },
    { id: "escort:citizenProviderAvailability", passed: /setEscortAppointmentAvailability/.test(citizenFrontend) && /escortProviderReady/.test(citizenFrontend) && /暂无可预约服务主体/.test(citizenFrontend) && /published !== false/.test(citizenFrontend) && /provider is not published/.test(server), detail: "citizen appointment is enabled only when a published provider is available" },
    { id: "escort:providerScopeGuard", passed: /provider not found/.test(server) && /provider is not published/.test(server) && /const provider = \(data\.escortServiceProviders \|\| \[\]\)\.find/.test(server), detail: "order creation rejects missing or unpublished provider registry rows" },
    { id: "escort:duplicateAppointmentGuard", passed: /findDuplicateActiveEscortAppointment/.test(server) && /duplicate active escort appointment/.test(server) && /409/.test(server), detail: "open resident escort appointments are idempotency-guarded by registration or visit slot" },
    { id: "escort:appointmentFieldGuard", passed: /hospital is required/.test(server) && /department is required/.test(server) && /appointmentAt is required/.test(server) && /serviceItems is required/.test(server) && /appointmentAt cannot be in the past/.test(server) && /isPastEscortAppointmentDate/.test(server), detail: "resident escort requests require hospital, department, service items, and non-past appointment date before dispatch" },
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
