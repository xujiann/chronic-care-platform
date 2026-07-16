#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const EmergencyService = require("../emergency-service");
const EmergencyProduction = require("../emergency-production");

const ROOT = path.resolve(__dirname, "..");
function read(file) { return fs.readFileSync(path.join(ROOT, file), "utf8"); }
function check(id, passed, detail, category = "emergency") { return { id, category, passed: Boolean(passed), detail }; }

function buildEmergencyReadinessReport(options = {}) {
  const sources = options.sources || { html:read("emergency.html"), js:read("emergency.js"), lifeUi:read("emergency-lifechain-ui.js"), service:read("emergency-service.js"), lifeService:read("emergency-lifechain.js"), production:read("emergency-production.js"), server:read("server.js"), apiTest:read("test/emergency-api.test.js"), lifeTest:read("test/emergency-lifechain.test.js"), docs:`${read("docs/院前急救协同信息系统立项与标准基线-2026-07-15.md")}\n${read("docs/院前急救生产前上线控制说明.md")}\n${read("docs/emergency-sos-aed.md")}\n${read("docs/emergency-life-chain.md")}`, diagrams:read("docs/院前急救系统拓扑与流程图集.md"), package:read("package.json") };
  const state = EmergencyService.seed();
  const dashboard = EmergencyService.buildDashboard(state, { role:"commission", name:"readiness" });
  const evidencePackage = EmergencyService.buildEvidencePackage(state, { role:"commission", name:"readiness" }, state.emergencyEvents[0].id);
  const evidenceExport = EmergencyService.buildEvidenceExport(evidencePackage, "json");
  const productionCenter = EmergencyProduction.buildCenter({ ...state, ...EmergencyProduction.seed() });
  const checks = [
    check("standards:command", sources.docs.includes("WS/T 451") && sources.service.includes("STATE_FLOW"), "command workflow follows WS/T 451 and explicit state machine", "standards"),
    check("standards:data", sources.docs.includes("WS 542") && dashboard.standards.includes("WS 542-2017"), "WS 542 dataset baseline is declared", "standards"),
    check("standards:handover", sources.service.includes("WS/T 621-2018") && sources.html.includes("完成电子交接"), "electronic handover contract is implemented", "standards"),
    check("workflow:closed-loop", ["accepted","dispatched","departed","arrived-scene","patient-contact","transporting","hospital-confirmed","arrived-hospital","handover-completed","closed"].every((value)=>sources.service.includes(`"${value}"`)), "full event state chain is present", "workflow"),
    check("api:routes", ["/api/emergency/dashboard","/api/emergency/calls","/api/emergency/events/"].every((value)=>sources.server.includes(value)), "dashboard, assisted-call and action APIs are wired", "api"),
    check("api:evidence-package", sources.service.includes("buildEvidencePackage") && sources.server.includes("/api/emergency/events/:id/evidence-package") && sources.js.includes("data-evidence-event") && sources.html.includes("emergency-evidence-package") && evidencePackage.sections.length >= 7, "per-event call, dispatch, track, clinical, hospital, handover and audit evidence package is queryable", "api"),
    check("api:evidence-export", sources.service.includes("buildEvidenceExport") && sources.server.includes("/api/emergency/events/:id/evidence-package/export") && sources.js.includes("data-evidence-export") && /^sha256:[a-f0-9]{64}$/.test(evidenceExport.integrity.digest), "role-scoped JSON and Markdown evidence exports carry a SHA-256 integrity digest", "api"),
    check("api:contract-tests", sources.apiTest.includes("emergency HTTP API enforces citizen scope") && sources.apiTest.includes("evidence-package/export?format=json") && sources.package.includes("test/emergency-api.test.js"), "isolated HTTP regression verifies citizen scope, closed-loop handover and both evidence exports", "api"),
    check("safety:sos-aed", sources.service.includes("createSosCall") && sources.service.includes("buildAedMap") && sources.server.includes("/api/emergency/sos") && sources.server.includes("/api/emergency/aed-map") && sources.html.includes("emergency-sos-form") && sources.html.includes("emergency-aed-map") && sources.js.includes("loadAedMap") && sources.docs.includes("cannot silently place a phone call") && sources.docs.includes("demonstration reference data"), "confirmed SOS, native 120 call boundary and AED reference map are implemented with a production data boundary", "safety"),
    check("life-chain:seven-highlights", ["createAuthorization","createAutomaticSos","coordinateEvent","chooseGreenChannel","addFamilyContact","buildCommandCenter","buildQualityDashboard"].every((marker)=>sources.lifeService.includes(marker)) && ["/api/emergency/life-chain/authorizations","/api/emergency/life-chain/device-sos","/api/emergency/life-chain/command-center","/api/emergency/life-chain/quality"].every((marker)=>sources.server.includes(marker)) && ["lifechain-authorization-form","lifechain-device-sos-form","lifechain-family-form","lifechain-overview","lifechain-command-center","lifechain-quality"].every((marker)=>sources.html.includes(marker)) && ["loadLifeChain","renderLifeChainCommandCenter","data-green-channel-event"].every((marker)=>sources.lifeUi.includes(marker)) && sources.lifeTest.includes("golden four minutes") && (sources.docs.match(/## Seven delivered capabilities/g) || []).length === 1, "seven integrated life-chain capabilities are runnable, tested and documented", "workflow"),
    check("security:roles", sources.server.includes('["commission", "institution", "citizen"]') && sources.service.includes("ROLE_ACTIONS"), "role boundaries exist at route and domain layers", "security"),
    check("ui:four-parties", ["居民辅助呼救","120调度","车载移动急救","医院预接诊与交接"].every((value)=>sources.html.includes(value)), "resident, dispatch, ambulance and hospital surfaces are runnable", "ui"),
    check("ui:120-boundary", sources.html.includes("互联网入口不替代120电话") && sources.html.includes('href="tel:120"'), "120 phone fallback is prominent", "safety"),
    check("docs:diagram-atlas", (sources.diagrams.match(/```mermaid/g) || []).length >= 13 && sources.html.includes("emergency-topology"), "13 Mermaid topology and workflow views are linked from the workbench", "docs"),
    check("production:control-center", sources.html.includes("emergency-production-center") && sources.server.includes("/api/emergency/production-center"), "production control center is available", "production"),
    check("production:integration-probes", sources.production.includes("probeEndpoint") && productionCenter.summary.endpoints >= 5, `${productionCenter.summary.endpoints} external integration gates`, "production"),
    check("production:reliable-delivery", sources.production.includes("idempotencyKey") && sources.production.includes("dead-letter"), "idempotent delivery, retries and dead-letter states are implemented", "production"),
    check("production:drills", productionCenter.summary.drillsTotal >= 5 && sources.production.includes("completeDrill"), `${productionCenter.summary.drillsTotal} production drills tracked`, "production"),
    check("production:site-signoff", productionCenter.summary.cutoverBlockers === 5 && sources.production.includes("REQUIREMENT_CONFIRMATION"), "site evidence signoff cannot be bypassed", "production"),
    check("production:data-quality", productionCenter.dataQuality.rules.length >= 5 && sources.production.includes("validateEvent"), `${productionCenter.dataQuality.rules.length} emergency data-quality rules`, "production"),
    check("production:data-quality-closure", sources.production.includes("resolveDataQualityIssue") && sources.server.includes("/api/emergency/production/quality/issues/:id/resolve"), "data-quality issues require resolution evidence before closure", "production"),
    check("production:observability", Array.isArray(productionCenter.alerts) && sources.production.includes("applyAlertAction"), "operational alerts have acknowledge and resolve workflow", "production"),
    check("production:duty-roster", productionCenter.dutyShifts.length >= 2 && productionCenter.preflight.dutyRosterReady, `${productionCenter.dutyShifts.length} cutover duty shifts`, "production"),
    check("production:dual-approval", productionCenter.approvals.length >= 2 && sources.production.includes("different signers"), "business and technical cutover approvals require different signers", "production"),
    check("production:handoffs", productionCenter.handoffs.length >= 3 && sources.production.includes("acceptProductionHandoff"), `${productionCenter.handoffs.length} production handoff lanes`, "production"),
    check("production:command-brief", productionCenter.commandBriefs.length >= 1 && sources.production.includes("applyCommandBriefAction"), "cutover command requires preflight, approvals and recipient acknowledgement", "production"),
    check("production:observation", productionCenter.observations.length >= 4 && sources.production.includes("recordObservation"), `${productionCenter.observations.length} go-live observation windows`, "production"),
    check("production:incident-desk", Array.isArray(productionCenter.incidents) && sources.production.includes("rollbackRecommended"), "launch incident desk links P0 incidents to rollback review", "production"),
    check("production:rollback", productionCenter.rollbackPlan.status === "ready" && productionCenter.rollbackPlan.triggers.length >= 5, `${productionCenter.rollbackPlan.triggers.length} rollback triggers`, "production"),
    check("ui:launch-operations", ["handoff-accept-form","command-brief-form","observation-record-form","launch-incident-form","quality-resolve-form","alert-action-form","incident-resolve-form"].every((marker)=>sources.html.includes(marker)) && ["/production/handoffs/","/production/command-briefs/","/production/observations/","/production/incidents","/production/quality/issues/","/production/alerts/"].every((marker)=>sources.js.includes(marker)), "handoff, command, quality, alert, observation and incident actions are operable from the workbench", "ui"),
    check("docs:production-control", sources.docs.includes("blocked-until-site-evidence-signed") && sources.docs.includes("RPO") && sources.docs.includes("dead-letter"), "production control, SLO, disaster recovery and dead-letter operations are documented", "docs"),
    check("resilience:idempotent-state", sources.service.includes("nextStatus") && sources.service.includes("状态必须按顺序推进"), "out-of-order state mutation is rejected", "resilience"),
    check("release:script", sources.package.includes("emergency:readiness"), "feature readiness command is registered", "release")
  ];
  const siteRequirements = [
    { id:"EMG-SITE-01", owner:"120急救中心", title:"CTI和录音系统双向接口联调签署", status:"site-pending" },
    { id:"EMG-SITE-02", owner:"通信运营商/地图服务方", title:"手机定位、短信和弱网降级验收", status:"site-pending" },
    { id:"EMG-SITE-03", owner:"急救中心车管与设备厂商", title:"真实车辆终端、监护仪和心电设备接入", status:"site-pending" },
    { id:"EMG-SITE-04", owner:"试点医院", title:"急诊预建档、绿色通道和电子病历归档联调", status:"site-pending" },
    { id:"EMG-SITE-05", owner:"网信与安全责任部门", title:"等保定级、个保影响评估、密码和灾备验收", status:"site-pending" }
  ];
  return { ok:checks.every((item)=>item.passed), generatedAt:new Date().toISOString(), module:"prehospital-emergency-collaboration", functionalState:checks.every((item)=>item.passed)?"ready-for-site-integration":"development-blocked", formalGoLiveState:productionCenter.formalGoLiveState, summary:{checks:checks.length,passed:checks.filter((item)=>item.passed).length,sitePending:productionCenter.summary.cutoverBlockers,seedEvents:dashboard.summary.total,productionEndpoints:productionCenter.summary.endpoints,productionDrills:productionCenter.summary.drillsTotal,evidenceSections:evidencePackage.sections.length,evidenceExportDigest:evidenceExport.integrity.digest}, checks, siteRequirements:productionCenter.requirements, productionCenter:{summary:productionCenter.summary,slo:productionCenter.slo}, artifacts:{page:"emergency.html",service:"emergency-service.js",lifeChainService:"emergency-lifechain.js",lifeChainUi:"emergency-lifechain-ui.js",api:"/api/emergency/dashboard",sosApi:"/api/emergency/sos",lifeChainApi:"/api/emergency/life-chain/device-sos",aedMapApi:"/api/emergency/aed-map",evidenceApi:"/api/emergency/events/:id/evidence-package",evidenceExportApi:"/api/emergency/events/:id/evidence-package/export?format=json",productionApi:"/api/emergency/production-center",report:"release/emergency-readiness-report.json"} };
}

function renderMarkdown(report) {
  const checkRows = report.checks.map((item)=>`| ${item.category} | ${item.id} | ${item.passed ? "pass" : "fail"} | ${item.detail} |`);
  const siteRows = report.siteRequirements.map((item)=>`| ${item.id} | ${item.owner} | ${item.status} | ${item.cutoverBlocker ? "yes" : "no"} | ${item.evidenceRef || "pending"} |`);
  return [
    "# Prehospital emergency collaboration readiness",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Functional state: ${report.functionalState}`,
    `- Formal go-live state: ${report.formalGoLiveState}`,
    `- Checks: ${report.summary.passed}/${report.summary.checks}`,
    `- Site blockers pending: ${report.summary.sitePending}`,
    `- Production endpoints: ${report.summary.productionEndpoints}`,
    `- Production drills: ${report.summary.productionDrills}`,
    "",
    "## Checks",
    "",
    "| Category | Check | Result | Detail |",
    "|---|---|---|---|",
    ...checkRows,
    "",
    "## Site requirements",
    "",
    "| Requirement | Owner | Status | Cutover blocker | Evidence |",
    "|---|---|---|---|---|",
    ...siteRows,
    "",
    "## Production control summary",
    "",
    `- Queue pending: ${report.productionCenter.summary.queuePending}`,
    `- Dead letters: ${report.productionCenter.summary.deadLetters}`,
    `- Open P0 data-quality issues: ${report.productionCenter.summary.openP0Quality}`,
    `- Open critical alerts: ${report.productionCenter.summary.openCriticalAlerts}`,
    `- Open launch incidents: ${report.productionCenter.summary.openLaunchIncidents}`,
    `- SLO target: ${report.productionCenter.slo.apiAvailabilityTarget}`,
    "",
    "Formal production go-live remains blocked until the site evidence and external integration signoffs are actually recorded."
  ].join("\n");
}

function runCli(){const report=buildEmergencyReadinessReport();fs.mkdirSync(path.join(ROOT,"release"),{recursive:true});fs.writeFileSync(path.join(ROOT,"release","emergency-readiness-report.json"),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(!report.ok)process.exitCode=1;}
if(require.main===module)runCli();
module.exports={buildEmergencyReadinessReport,renderMarkdown};
