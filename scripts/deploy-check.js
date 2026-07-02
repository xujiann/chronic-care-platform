#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function run(command, args) {
  const commandLine = [command, ...args].join(" ");
  const result = process.platform === "win32"
    ? spawnSync(commandLine, { cwd: ROOT, stdio: "pipe", shell: true, encoding: "utf8" })
    : spawnSync(command, args, { cwd: ROOT, stdio: "pipe", shell: false, encoding: "utf8" });
  return {
    command: commandLine,
    status: result.status,
    ok: result.status === 0,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim()
  };
}

function assertFile(relativePath) {
  const file = path.join(ROOT, relativePath);
  return { name: `file:${relativePath}`, ok: fs.existsSync(file), detail: fs.existsSync(file) ? "present" : "missing" };
}

function buildDeployCheckReport(options = {}) {
  const pkg = readJson("package.json");
  const data = readJson("data/db.json");
  const requiredCollections = [
    "residents",
    "authUsers",
    "platformRoadmap",
    "platformInterfaces",
    "institutionCreditEvaluations",
    "creditEvaluationRules",
    "researchDatasets",
    "diseaseRegistryModels",
    "qualitySafetyEvents",
    "qualityRectificationOrders",
    "drugConsumableSupervisions",
    "dataAccessLogs",
    "mobileExperienceSettings",
    "accessibilityChecklist",
    "regionalDataSharingScope",
    "regionalSharingPackages",
    "regionalSharingSnapshots",
    "regionalSharingAccessReviews",
    "securityAcceptanceLedger",
    "hospitalOperationSnapshots",
    "resourceDispatchRequests",
    "statisticsReconciliationReviews",
    "operationAlertRules",
    "chronicFollowupStatusPolicy",
    "escortServicePolicy",
    "escortServiceProviders",
    "escortWorkers",
    "escortServiceOrders",
    "internetNursingPolicy",
    "internetNursingInstitutions",
    "internetNursingNurses",
    "internetNursingOrders",
    "doctorProfiles",
    "multiPracticePolicy",
    "multiPracticeApplications",
    "healthDashboardSnapshots"
  ];
  const p0Interfaces = (Array.isArray(data.platformInterfaces) ? data.platformInterfaces : []).filter((item) => item.priority === "P0");
  const securityAcceptanceLedger = Array.isArray(data.securityAcceptanceLedger) ? data.securityAcceptanceLedger : [];
  const serverSource = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
  const manifestSource = fs.readFileSync(path.join(ROOT, "scripts", "release-artifact-manifest.js"), "utf8");
  const escortHospitalInterfaceDoc = fs.readFileSync(path.join(ROOT, "docs", "escort-hospital-interface.md"), "utf8");
  const internetNursingDoc = fs.readFileSync(path.join(ROOT, "docs", "互联网护理服务模块说明.md"), "utf8");
  const productionGoLiveRequirementsDoc = fs.readFileSync(path.join(ROOT, "docs", "production-go-live-requirements.md"), "utf8");
  const onsiteLaunchMaterialsDoc = fs.readFileSync(path.join(ROOT, "docs", "on-site-launch-materials.md"), "utf8");
  const externalDependencyRiskIds = [
    "identity-source",
    "institution-systems",
    "insurance-core",
    "certificate-sharing",
    "security-assessment",
    "disaster-recovery"
  ];
  const checks = [
    assertFile("README.md"),
    assertFile("DEPLOYMENT.md"),
    assertFile("docs/production-go-live-requirements.md"),
    assertFile("docs/on-site-launch-materials.md"),
    assertFile("data/db.json"),
    assertFile("server.js"),
    assertFile("docs/citizen-production-launch-requirements.md"),
    assertFile("docs/escort-hospital-interface.md"),
    assertFile("scripts/onsite-launch-requirements.js"),
    assertFile("scripts/storage-admin.js"),
    assertFile("scripts/hybrid-deployment-readiness.js"),
    { name: "package:scripts", ok: Boolean(pkg.scripts?.check && pkg.scripts?.test && pkg.scripts?.["test:coverage"] && pkg.scripts?.["test:e2e"] && pkg.scripts?.["env:check"] && pkg.scripts?.["release:report"] && pkg.scripts?.["release:manifest"] && pkg.scripts?.["launch:smoke"] && pkg.scripts?.["onsite:launch-requirements"] && pkg.scripts?.["storage:inspect"] && pkg.scripts?.["identity:contract"] && pkg.scripts?.["audit:retention"] && pkg.scripts?.["data-quality:report"] && pkg.scripts?.["quality-safety:report"] && pkg.scripts?.["environment:matrix"] && pkg.scripts?.["hospital-operations:readiness"] && pkg.scripts?.["integration:readiness"] && pkg.scripts?.["interface:mapping"] && pkg.scripts?.["regional-data-sharing:report"] && pkg.scripts?.["referral:readiness"] && pkg.scripts?.["monitoring:readiness"] && pkg.scripts?.["operations:readiness"] && pkg.scripts?.["process:audit"] && pkg.scripts?.["site:pack"] && pkg.scripts?.["production-db:readiness"] && pkg.scripts?.["evaluation:evidence"]), detail: Object.keys(pkg.scripts || {}).join(",") },
    { name: "package:scripts", ok: Boolean(pkg.scripts?.check && pkg.scripts?.test && pkg.scripts?.["test:coverage"] && pkg.scripts?.["test:e2e"] && pkg.scripts?.["env:check"] && pkg.scripts?.["release:report"] && pkg.scripts?.["release:manifest"] && pkg.scripts?.["storage:inspect"] && pkg.scripts?.["identity:contract"] && pkg.scripts?.["audit:retention"] && pkg.scripts?.["data-quality:report"] && pkg.scripts?.["drug-consumable:readiness"] && pkg.scripts?.["environment:matrix"] && pkg.scripts?.["integration:readiness"] && pkg.scripts?.["interface:mapping"] && pkg.scripts?.["monitoring:readiness"] && pkg.scripts?.["operations:readiness"] && pkg.scripts?.["process:audit"] && pkg.scripts?.["site:pack"] && pkg.scripts?.["production-db:readiness"] && pkg.scripts?.["evaluation:evidence"]), detail: Object.keys(pkg.scripts || {}).join(",") },
    { name: "package:scripts", ok: Boolean(pkg.scripts?.check && pkg.scripts?.test && pkg.scripts?.["test:coverage"] && pkg.scripts?.["test:e2e"] && pkg.scripts?.["env:check"] && pkg.scripts?.["release:report"] && pkg.scripts?.["release:manifest"] && pkg.scripts?.["storage:inspect"] && pkg.scripts?.["identity:contract"] && pkg.scripts?.["audit:retention"] && pkg.scripts?.["chronic:followup-readiness"] && pkg.scripts?.["data-quality:report"] && pkg.scripts?.["environment:matrix"] && pkg.scripts?.["integration:readiness"] && pkg.scripts?.["interface:mapping"] && pkg.scripts?.["monitoring:readiness"] && pkg.scripts?.["operations:readiness"] && pkg.scripts?.["process:audit"] && pkg.scripts?.["site:pack"] && pkg.scripts?.["production-db:readiness"] && pkg.scripts?.["evaluation:evidence"]), detail: Object.keys(pkg.scripts || {}).join(",") },
    assertFile("scripts/research-sandbox-readiness.js"),
    { name: "package:scripts", ok: Boolean(pkg.scripts?.check && pkg.scripts?.test && pkg.scripts?.["test:coverage"] && pkg.scripts?.["test:e2e"] && pkg.scripts?.["env:check"] && pkg.scripts?.["release:report"] && pkg.scripts?.["release:manifest"] && pkg.scripts?.["storage:inspect"] && pkg.scripts?.["identity:contract"] && pkg.scripts?.["audit:retention"] && pkg.scripts?.["data-quality:report"] && pkg.scripts?.["environment:matrix"] && pkg.scripts?.["integration:readiness"] && pkg.scripts?.["interface:mapping"] && pkg.scripts?.["research:sandbox"] && pkg.scripts?.["monitoring:readiness"] && pkg.scripts?.["operations:readiness"] && pkg.scripts?.["process:audit"] && pkg.scripts?.["site:pack"] && pkg.scripts?.["production-db:readiness"] && pkg.scripts?.["evaluation:evidence"]), detail: Object.keys(pkg.scripts || {}).join(",") },
    { name: "package:scripts", ok: Boolean(pkg.scripts?.check && pkg.scripts?.test && pkg.scripts?.["test:coverage"] && pkg.scripts?.["test:e2e"] && pkg.scripts?.["env:check"] && pkg.scripts?.["release:report"] && pkg.scripts?.["release:manifest"] && pkg.scripts?.["storage:inspect"] && pkg.scripts?.["identity:contract"] && pkg.scripts?.["audit:retention"] && pkg.scripts?.["data-quality:report"] && pkg.scripts?.["environment:matrix"] && pkg.scripts?.["health-dashboard:summary"] && pkg.scripts?.["integration:readiness"] && pkg.scripts?.["interface:mapping"] && pkg.scripts?.["monitoring:readiness"] && pkg.scripts?.["operations:readiness"] && pkg.scripts?.["process:audit"] && pkg.scripts?.["site:pack"] && pkg.scripts?.["production-db:readiness"] && pkg.scripts?.["evaluation:evidence"]), detail: Object.keys(pkg.scripts || {}).join(",") },
    { name: "package:priorityApplicationTemplates", ok: Boolean(pkg.scripts?.["priority-apps:templates"]), detail: pkg.scripts?.["priority-apps:templates"] || "missing" },
    { name: "package:policyCoverage", ok: Boolean(pkg.scripts?.["policy:coverage"]), detail: pkg.scripts?.["policy:coverage"] || "missing" },
    { name: "package:maternalChildReadiness", ok: Boolean(pkg.scripts?.["maternal-child:readiness"]), detail: pkg.scripts?.["maternal-child:readiness"] || "missing" },
    { name: "package:escortReadiness", ok: Boolean(pkg.scripts?.["escort:readiness"]), detail: pkg.scripts?.["escort:readiness"] || "missing" },
    { name: "package:internetNursingReadiness", ok: Boolean(pkg.scripts?.["internet-nursing:readiness"]), detail: pkg.scripts?.["internet-nursing:readiness"] || "missing" },
    { name: "package:multiPracticeReadiness", ok: Boolean(pkg.scripts?.["multi-practice:readiness"]), detail: pkg.scripts?.["multi-practice:readiness"] || "missing" },
    { name: "package:hybridDeploymentReadiness", ok: Boolean(pkg.scripts?.["hybrid:deployment-readiness"]), detail: pkg.scripts?.["hybrid:deployment-readiness"] || "missing" },
    { name: "package:chronicInstitutionInterfaces", ok: Boolean(pkg.scripts?.["chronic:institution-interfaces"]), detail: pkg.scripts?.["chronic:institution-interfaces"] || "missing" },
    { name: "package:chronicLaunchCore", ok: Boolean(pkg.scripts?.["chronic:launch-core"]), detail: pkg.scripts?.["chronic:launch-core"] || "missing" },
    { name: "snapshot:collections", ok: requiredCollections.every((key) => data[key]), detail: requiredCollections.filter((key) => !data[key]).join(",") || "all present" },
    { name: "snapshot:regionalDataSharing", ok: (data.regionalSharingPackages || []).length >= 3 && (data.regionalSharingAccessReviews || []).length >= 1 && serverSource.includes("/api/regional-data-sharing"), detail: `${data.regionalSharingPackages?.length || 0} packages, ${data.regionalSharingAccessReviews?.length || 0} access reviews` },
    { name: "snapshot:escortService", ok: (data.escortServiceProviders || []).length >= 3 && (data.escortWorkers || []).length >= 4 && (data.escortServiceOrders || []).length >= 3 && serverSource.includes("/api/escort-services/dashboard"), detail: `${data.escortServiceProviders?.length || 0} providers, ${data.escortWorkers?.length || 0} workers, ${data.escortServiceOrders?.length || 0} orders` },
    { name: "docs:escortHospitalInterface", ok: escortHospitalInterfaceDoc.includes("POST /api/escort-services/orders/:id/hospital-handoff") && escortHospitalInterfaceDoc.includes("hospitalCode") && serverSource.includes("hospital-handoff"), detail: "escort hospital handoff API contract is documented and implemented" },
    { name: "snapshot:internetNursing", ok: (data.internetNursingInstitutions || []).length >= 2 && (data.internetNursingNurses || []).length >= 2 && (data.internetNursingOrders || []).length >= 3 && serverSource.includes("/api/internet-nursing/dashboard"), detail: `${data.internetNursingInstitutions?.length || 0} institutions, ${data.internetNursingNurses?.length || 0} nurses, ${data.internetNursingOrders?.length || 0} orders` },
    { name: "snapshot:internetNursingAuth", ok: (data.authUsers || []).some((item) => item.username === "nurse" && item.password === "123456" && item.home === "internet-nursing.html" && item.nurseId === "inn-001") && serverSource.includes('username: "nurse"') && serverSource.includes('password: "123456"'), detail: "nurse workstation demo account is seeded" },
    { name: "snapshot:multiPractice", ok: (data.doctorProfiles || []).length >= 2 && (data.multiPracticeApplications || []).length >= 2 && serverSource.includes("/api/multi-practice-registry") && serverSource.includes("multiPracticeSummary"), detail: `${data.doctorProfiles?.length || 0} doctors, ${data.multiPracticeApplications?.length || 0} applications` },
    { name: "docs:internetNursing", ok: internetNursingDoc.includes("flowchart TD") && internetNursingDoc.includes("nurse / 123456") && internetNursingDoc.includes("/api/internet-nursing/orders/:id/actions"), detail: "internet nursing module handoff document is complete" },
    { name: "docs:productionGoLiveRequirements", ok: productionGoLiveRequirementsDoc.includes("GL-01") && productionGoLiveRequirementsDoc.includes("launch:smoke -- --base-url") && productionGoLiveRequirementsDoc.includes("发布阻断条件"), detail: "real production go-live requirements are documented" },
    { name: "docs:onsiteLaunchMaterials", ok: ["GLM-01", "GLM-04", "GLM-05", "GLM-08", "GLM-10", "CIT-01", "CIT-06", "launch:smoke -- --base-url"].every((marker) => onsiteLaunchMaterialsDoc.includes(marker)), detail: "on-site launch material checklist covers platform and citizen evidence" },
    { name: "snapshot:interfaceReadiness", ok: p0Interfaces.length >= 4 && p0Interfaces.every((item) => item.id && item.owner && item.status && item.next), detail: `${p0Interfaces.length} P0 interface tracks` },
    { name: "snapshot:securityAcceptance", ok: securityAcceptanceLedger.length >= 4 && securityAcceptanceLedger.every((item) => item.id && item.category && item.owner && item.status && item.next), detail: `${securityAcceptanceLedger.length} security acceptance items` },
    { name: "snapshot:qualitySafety", ok: Array.isArray(data.qualitySafetyEvents) && data.qualitySafetyEvents.length >= 3 && Array.isArray(data.qualityRectificationOrders) && data.qualityRectificationOrders.length >= 1, detail: `${data.qualitySafetyEvents?.length || 0} events, ${data.qualityRectificationOrders?.length || 0} rectifications` },
    { name: "snapshot:chronicFollowupStatusPolicy", ok: Boolean(data.chronicFollowupStatusPolicy?.version && data.chronicFollowupStatusPolicy?.statusGroups?.open && data.chronicFollowupStatusPolicy?.requiredEvidence?.followup), detail: data.chronicFollowupStatusPolicy?.version || "missing" },
    { name: "snapshot:researchSandbox", ok: (data.researchDatasets || []).some((item) => item.authorizationStatus === "approved" && (item.deidentificationStatus === "released" || item.anonymization) && (item.sandbox?.status === "active" || item.status === "published")) && (data.dataAccessLogs || []).some((item) => /research|科研|数据集|沙箱/i.test(`${item.scope || ""} ${item.purpose || ""}`)), detail: `${data.researchDatasets?.length || 0} datasets / ${data.dataAccessLogs?.length || 0} audit logs` },
    { name: "snapshot:externalDependencyRisks", ok: externalDependencyRiskIds.every((id) => serverSource.includes(id)), detail: `${externalDependencyRiskIds.length} external dependency risks` },
    { name: "snapshot:p2-complete", ok: (data.platformRoadmap || []).filter((item) => item.priority === "P2").every((item) => item.status === "已完成"), detail: (data.platformRoadmap || []).filter((item) => item.priority === "P2").map((item) => `${item.title}:${item.status}`).join(";") },
    { name: "snapshot:accessibility", ok: Array.isArray(data.accessibilityChecklist) && data.accessibilityChecklist.length >= 5, detail: `${data.accessibilityChecklist?.length || 0} checklist items` },
    { name: "snapshot:healthDashboard", ok: Array.isArray(data.healthDashboardSnapshots) && data.healthDashboardSnapshots.some((item) => Array.isArray(item.sourceApplications) && item.sourceApplications.length === 7), detail: `${data.healthDashboardSnapshots?.length || 0} dashboard snapshots` },
    { name: "manifest:healthDashboardSummary", ok: manifestSource.includes("health-dashboard-summary.md") && manifestSource.includes("health-dashboard:summary"), detail: "health dashboard summary artifact is indexed" },
    { name: "manifest:launchSmoke", ok: manifestSource.includes("launch-smoke-report.md") && manifestSource.includes("launch:smoke"), detail: "launch smoke artifact is indexed" },
    { name: "manifest:onsiteLaunchRequirements", ok: manifestSource.includes("onsite-launch-requirements.md") && manifestSource.includes("onsite:launch-requirements"), detail: "on-site launch requirements artifact is indexed" },
    { name: "manifest:priorityApplicationTemplates", ok: manifestSource.includes("priority-application-templates.md") && manifestSource.includes("priority-apps:templates"), detail: "priority application template artifact is indexed" },
    { name: "manifest:citizenLaunchFoundation", ok: manifestSource.includes("citizen-launch-foundation-readiness.md") && manifestSource.includes("citizen:launch-foundation"), detail: "citizen launch foundation artifact is indexed" },
    { name: "manifest:policyCoverage", ok: manifestSource.includes("policy-coverage-report.md") && manifestSource.includes("policy:coverage"), detail: "policy coverage artifact is indexed" },
    { name: "manifest:maternalChildReadiness", ok: manifestSource.includes("maternal-child-readiness-report.md") && manifestSource.includes("maternal-child:readiness"), detail: "maternal-child readiness artifact is indexed" },
    { name: "manifest:escortServiceReadiness", ok: manifestSource.includes("escort-service-readiness-report.md") && manifestSource.includes("escort:readiness"), detail: "escort service readiness artifact is indexed" },
    { name: "manifest:internetNursingReadiness", ok: manifestSource.includes("internet-nursing-readiness-report.md") && manifestSource.includes("internet-nursing:readiness"), detail: "internet nursing readiness artifact is indexed" },
    { name: "manifest:multiPracticeReadiness", ok: manifestSource.includes("multi-practice-readiness-report.md") && manifestSource.includes("multi-practice:readiness"), detail: "multi-practice readiness artifact is indexed" },
    { name: "manifest:hybridDeploymentReadiness", ok: manifestSource.includes("hybrid-deployment-readiness-report.md") && manifestSource.includes("hybrid:deployment-readiness"), detail: "hybrid deployment readiness artifact is indexed" },
    { name: "snapshot:storageMeta", ok: Boolean(data.storageMeta?.engine && data.storageMeta?.mode), detail: data.storageMeta ? `${data.storageMeta.engine}/${data.storageMeta.mode}` : "missing" }
  ];

  const runCommands = options.runCommands === true;
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const commandResults = runCommands ? [
    run(npm, ["run", "check"]),
    run(npm, ["test"]),
    run(npm, ["run", "test:coverage"]),
    run(npm, ["run", "test:e2e"]),
    run(npm, ["audit", "--omit=dev"])
  ] : [];
  const allChecks = [...checks, ...commandResults.map((item) => ({ name: `command:${item.command}`, ok: item.ok, detail: item.ok ? "passed" : item.stderr || item.stdout }))];
  const report = {
    ok: allChecks.every((item) => item.ok),
    checkedAt: new Date().toISOString(),
    project: pkg.name,
    version: pkg.version,
    checks: allChecks
  };
  return report;
}

function main() {
  const report = buildDeployCheckReport({
    runCommands: process.argv.includes("--run-commands")
  });
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}

if (require.main === module) main();

module.exports = {
  buildDeployCheckReport,
  run
};
