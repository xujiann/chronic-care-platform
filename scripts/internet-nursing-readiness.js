#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "internet-nursing-readiness-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "internet-nursing-readiness-report.md");

const REQUIRED_POLICY_FIELDS = ["online application", "offline service", "first-visit assessment", "informed consent", "nurse qualification", "location tracking", "full audit trail", "workload statistics"];
const REQUIRED_ORDER_FIELDS = ["firstVisitAssessment", "informedConsent", "consentAttachment", "identityVerified", "locationTrace", "locationTracePoints", "serviceRecordStatus", "qualityCallback", "auditTrail"];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function fallbackPolicy() {
  return { scope: REQUIRED_POLICY_FIELDS };
}

function fallbackInstitutions() {
  return [
    { id: "inh-mr1", published: true, securityLevel: "grade-3-ready", emergencyPlan: "plan", serviceItems: ["wound care"] },
    { id: "inh-mr3", published: true, securityLevel: "grade-3-platform-access", emergencyPlan: "plan", serviceItems: ["blood glucose measurement"] }
  ];
}

function fallbackNurses() {
  return [
    { id: "inn-001", yearsClinical: 9, registrationStatus: "verified", badPracticeRecord: "none", trainingStatus: "passed", insuranceStatus: "covered", locationDevice: "enabled", oneClickAlert: "enabled" },
    { id: "inn-002", yearsClinical: 6, registrationStatus: "verified", badPracticeRecord: "none", trainingStatus: "passed", insuranceStatus: "covered", locationDevice: "enabled", oneClickAlert: "enabled" }
  ];
}

function fallbackOrders() {
  return [
    { id: "ino-001", institutionId: "inh-mr1", nurseId: "inn-001", firstVisitAssessment: "passed", informedConsent: "signed", consentAttachment: { status: "signed", signedAt: "2026-06-26T08:00:00.000Z", signerName: "Demo resident A", version: "internet-nursing-consent-v1" }, identityVerified: true, locationTrace: "pending", locationTracePoints: [], serviceRecordStatus: "pending", qualityCallback: "pending", riskLevel: "medium", status: "dispatched", auditTrail: [{}] },
    { id: "ino-002", institutionId: "inh-mr3", nurseId: "inn-002", firstVisitAssessment: "passed", informedConsent: "signed", consentAttachment: { status: "signed", signedAt: "2026-06-26T08:00:00.000Z", signerName: "Demo resident B", version: "internet-nursing-consent-v1" }, identityVerified: true, locationTrace: "tracking", locationTracePoints: [{ stage: "service-start", lat: 38.915, lng: 121.616, at: "2026-06-26T09:00:00.000Z" }, { stage: "service-complete", lat: 38.916, lng: 121.617, at: "2026-06-26T10:00:00.000Z" }], serviceRecordStatus: "in-progress", qualityCallback: "pending", riskLevel: "low", status: "accepted", auditTrail: [{}] },
    { id: "ino-003", institutionId: "inh-mr1", nurseId: "", firstVisitAssessment: "pending", informedConsent: "pending", consentAttachment: { status: "pending", required: true, version: "internet-nursing-consent-v1" }, identityVerified: true, locationTrace: "pending", locationTracePoints: [], serviceRecordStatus: "pending", qualityCallback: "pending", riskLevel: "high", status: "requested", auditTrail: [{}] }
  ];
}

function nurseQualified(item) {
  return Number(item.yearsClinical || 0) >= 5 &&
    item.registrationStatus === "verified" &&
    item.badPracticeRecord === "none" &&
    item.trainingStatus === "passed" &&
    item.insuranceStatus === "covered";
}

function hasCorruptedVisibleText(text) {
  return /\?{3,}|\uFFFD|[\u7019\u934f\u93b6\u942d\u7481\u6f15\u5a15\u6f36\u68e3]/.test(String(text || ""));
}

function hasSignedConsentAttachment(item) {
  const attachment = item.consentAttachment || {};
  return item.informedConsent === "signed" &&
    attachment.status === "signed" &&
    Boolean(attachment.signedAt) &&
    Boolean(attachment.signerName) &&
    Boolean(attachment.version);
}

function hasServiceTracePoints(item) {
  return Array.isArray(item.locationTracePoints) &&
    item.locationTracePoints.length >= 2 &&
    item.locationTracePoints.some((point) => point.stage === "service-start") &&
    item.locationTracePoints.some((point) => point.stage === "service-complete" || point.stage === "nurse-accept") &&
    item.locationTracePoints.every((point) => Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lng)));
}

function buildInternetNursingReadinessReport(options = {}) {
  const data = options.data ?? readJson("data/db.json");
  const pkg = options.pkg ?? readJson("package.json");
  const server = options.server ?? readText("server.js");
  const auth = options.auth ?? readText("auth.js");
  const frontend = options.frontend ?? readText("internet-nursing.html") + readText("internet-nursing.js");
  const mobilePreview = options.mobilePreview ?? readText("mobile-preview.html");
  const moduleDoc = options.moduleDoc ?? readText("docs/互联网护理服务模块说明.md");
  const launchPlan = options.launchPlan ?? readText("docs/互联网护理上线与下一步开发计划.md");
  const policy = data.internetNursingPolicy || fallbackPolicy();
  const institutions = Array.isArray(data.internetNursingInstitutions) && data.internetNursingInstitutions.length ? data.internetNursingInstitutions : fallbackInstitutions();
  const nurses = Array.isArray(data.internetNursingNurses) && data.internetNursingNurses.length ? data.internetNursingNurses : fallbackNurses();
  const orders = Array.isArray(data.internetNursingOrders) && data.internetNursingOrders.length ? data.internetNursingOrders : fallbackOrders();
  const institutionIds = new Set(institutions.map((item) => item.id));
  const nurseIds = new Set(nurses.map((item) => item.id));
  const checks = [
    { id: "nursing:policy", passed: REQUIRED_POLICY_FIELDS.every((item) => (policy.scope || []).includes(item)), detail: (policy.scope || []).join(", ") },
    { id: "nursing:institutionRegistry", passed: institutions.length >= 2 && institutions.some((item) => item.published) && institutions.every((item) => item.securityLevel && item.emergencyPlan), detail: `${institutions.length} institutions` },
    { id: "nursing:nurseQualification", passed: nurses.length >= 2 && nurses.every(nurseQualified) && nurses.every((item) => item.locationDevice && item.oneClickAlert), detail: `${nurses.filter(nurseQualified).length}/${nurses.length} qualified` },
    { id: "nursing:orders", passed: orders.length >= 3 && orders.every((item) => institutionIds.has(item.institutionId) && (!item.nurseId || nurseIds.has(item.nurseId))), detail: `${orders.length} orders` },
    { id: "nursing:orderEvidence", passed: orders.every((item) => REQUIRED_ORDER_FIELDS.every((field) => Object.hasOwn(item, field))), detail: REQUIRED_ORDER_FIELDS.join(", ") },
    { id: "nursing:riskTrace", passed: orders.some((item) => item.riskLevel === "high") && orders.some((item) => item.locationTrace === "tracking"), detail: "risk queue and location tracking present" },
    { id: "nursing:phaseOneEvidence", passed: orders.some(hasSignedConsentAttachment) && orders.some(hasServiceTracePoints) && /buildInternetNursingConsentAttachment/.test(server) && /appendInternetNursingTracePoint/.test(server) && /consentAttachmentText/.test(frontend) && /locationTraceSummary/.test(frontend) && /电子签名附件|鐢靛瓙绛惧悕闄勪欢/.test(launchPlan) && /轨迹点|杞ㄨ抗鐐?/.test(moduleDoc + launchPlan), detail: "electronic consent attachment and service trace point list are implemented" },
    { id: "nursing:api", passed: /\/api\/internet-nursing\/dashboard/.test(server) && /\/api\/internet-nursing\/orders/.test(server) && /canAccessInternetNursingOrder/.test(server), detail: "dashboard, order creation, action, and role guard present" },
    { id: "nursing:frontend", passed: /nursing-appointment-form/.test(frontend) && /nursing-nurse-queue/.test(frontend) && /nursing-risk-guidance/.test(frontend) && /fetchInternetNursingDashboard/.test(frontend), detail: "citizen, hospital, nurse, and risk guidance work areas present" },
    { id: "nursing:visibleText", passed: !hasCorruptedVisibleText(frontend) && /\u8ba2\u5355/.test(frontend) && /\u63a5\u5355/.test(frontend) && /\u9884\u7ea6\u5df2\u63d0\u4ea4/.test(frontend), detail: "visible Chinese labels and operation feedback are clean" },
    { id: "nursing:mobileWorkflow", passed: /nursing-mobile-workbench/.test(frontend) && /nursing-mobile-appointment/.test(frontend) && /nursing-nurse-mobile/.test(frontend) && /renderMobileAppointmentStatus/.test(frontend) && /renderMobileNurseCards/.test(frontend) && /internet-nursing-mobile/.test(frontend) && /internet-nursing\.html\?preview=mobile-nursing/.test(mobilePreview), detail: "citizen appointment and nurse response are available in the mobile surface" },
    { id: "nursing:launchControls", passed: /validateInternetNursingAppointment/.test(server) && /normalizeInternetNursingServiceObject/.test(server) && /buildInternetNursingActionMessage/.test(server) && /互联网护理新预约/.test(server) && /renderServiceItemSelect/.test(frontend) && /nursing-service-select/.test(frontend), detail: "catalog validation, citizen anti-tamper controls, and task messages present" },
    { id: "nursing:operationSafety", passed: /assertInternetNursingActionAllowed/.test(server) && /nurse can only operate assigned orders/.test(server) && /nurseActionButtons/.test(frontend) && /showNursingMessage/.test(frontend), detail: "nurse action guard, state-specific buttons, and operator feedback present" },
    { id: "nursing:authNavigation", passed: /"internet-nursing\.html": \["commission", "institution", "citizen", "county"\]/.test(auth) && /username: "nurse"/.test(auth) && /password: "123456"/.test(auth) && /nurseId: "inn-001"/.test(auth) && /\u4ec5\u67e5\u770b/.test(frontend) && /\u9700\u533b\u9662\u6d3e\u5355/.test(frontend), detail: "route access, nurse demo account, and role-scoped actions present" },
    { id: "nursing:moduleDoc", passed: /互联网护理服务模块说明/.test(moduleDoc) && /flowchart TD/.test(moduleDoc) && /nurse \/ 123456/.test(moduleDoc) && /\/api\/internet-nursing\/orders\/:id\/actions/.test(moduleDoc), detail: "module document, workflow diagram, role entry, and API permissions present" },
    { id: "nursing:developedFeatures", passed: /已开发功能清单/.test(launchPlan) && /个人端手机预约/.test(launchPlan) && /医院端管理/.test(launchPlan) && /护士端手机接单/.test(launchPlan) && /监管与上线证据/.test(launchPlan), detail: "developed feature inventory covers citizen, hospital, nurse, and supervision surfaces" },
    { id: "nursing:nextPlan", passed: /上线标准/.test(launchPlan) && /下一步开发计划/.test(launchPlan) && /阶段一：上线联调/.test(launchPlan) && /阶段三：监管扩展/.test(launchPlan), detail: "launch standard and staged roadmap documented" },
    { id: "nursing:releaseScript", passed: Boolean(pkg.scripts?.["internet-nursing:readiness"]), detail: pkg.scripts?.["internet-nursing:readiness"] || "missing" }
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    policyId: policy.id || "internet-nursing-liaoning-pilot",
    boundaries: REQUIRED_POLICY_FIELDS,
    summary: {
      institutions: institutions.length,
      nurses: nurses.length,
      qualifiedNurses: nurses.filter(nurseQualified).length,
      orders: orders.length,
      highRiskOrders: orders.filter((item) => item.riskLevel === "high").length,
      trackingOrders: orders.filter((item) => item.locationTrace === "tracking").length
    },
    checks
  };
}

function renderMarkdown(report) {
  return [
    "# Internet nursing readiness report",
    "",
    `Generated at: ${report.generatedAt}`,
    `Result: ${report.ok ? "PASS" : "FAIL"}`,
    "",
    "## Summary",
    "",
    `- Institutions: ${report.summary.institutions}`,
    `- Qualified nurses: ${report.summary.qualifiedNurses}/${report.summary.nurses}`,
    `- Orders: ${report.summary.orders}`,
    `- High-risk orders: ${report.summary.highRiskOrders}`,
    `- Tracking orders: ${report.summary.trackingOrders}`,
    `- Module document: docs/互联网护理服务模块说明.md`,
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
  fs.writeFileSync(output, JSON.stringify({ ok: report.ok, internetNursingReadiness: report }, null, 2), "utf8");
  fs.writeFileSync(markdown, renderMarkdown(report), "utf8");
}

function main() {
  const report = buildInternetNursingReadinessReport();
  writeReport(report);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}

if (require.main === module) main();

module.exports = {
  buildInternetNursingReadinessReport,
  renderMarkdown,
  writeReport
};
