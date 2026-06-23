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
    "chronicFollowupStatusPolicy"
  ];
  const p0Interfaces = (Array.isArray(data.platformInterfaces) ? data.platformInterfaces : []).filter((item) => item.priority === "P0");
  const securityAcceptanceLedger = Array.isArray(data.securityAcceptanceLedger) ? data.securityAcceptanceLedger : [];
  const serverSource = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
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
    assertFile("data/db.json"),
    assertFile("server.js"),
    assertFile("scripts/storage-admin.js"),
    { name: "package:scripts", ok: Boolean(pkg.scripts?.check && pkg.scripts?.test && pkg.scripts?.["test:coverage"] && pkg.scripts?.["test:e2e"] && pkg.scripts?.["env:check"] && pkg.scripts?.["release:report"] && pkg.scripts?.["release:manifest"] && pkg.scripts?.["storage:inspect"] && pkg.scripts?.["identity:contract"] && pkg.scripts?.["audit:retention"] && pkg.scripts?.["data-quality:report"] && pkg.scripts?.["quality-safety:report"] && pkg.scripts?.["environment:matrix"] && pkg.scripts?.["hospital-operations:readiness"] && pkg.scripts?.["integration:readiness"] && pkg.scripts?.["interface:mapping"] && pkg.scripts?.["regional-data-sharing:report"] && pkg.scripts?.["referral:readiness"] && pkg.scripts?.["monitoring:readiness"] && pkg.scripts?.["operations:readiness"] && pkg.scripts?.["process:audit"] && pkg.scripts?.["site:pack"] && pkg.scripts?.["production-db:readiness"] && pkg.scripts?.["evaluation:evidence"]), detail: Object.keys(pkg.scripts || {}).join(",") },
    { name: "package:scripts", ok: Boolean(pkg.scripts?.check && pkg.scripts?.test && pkg.scripts?.["test:coverage"] && pkg.scripts?.["test:e2e"] && pkg.scripts?.["env:check"] && pkg.scripts?.["release:report"] && pkg.scripts?.["release:manifest"] && pkg.scripts?.["storage:inspect"] && pkg.scripts?.["identity:contract"] && pkg.scripts?.["audit:retention"] && pkg.scripts?.["data-quality:report"] && pkg.scripts?.["drug-consumable:readiness"] && pkg.scripts?.["environment:matrix"] && pkg.scripts?.["integration:readiness"] && pkg.scripts?.["interface:mapping"] && pkg.scripts?.["monitoring:readiness"] && pkg.scripts?.["operations:readiness"] && pkg.scripts?.["process:audit"] && pkg.scripts?.["site:pack"] && pkg.scripts?.["production-db:readiness"] && pkg.scripts?.["evaluation:evidence"]), detail: Object.keys(pkg.scripts || {}).join(",") },
    { name: "package:scripts", ok: Boolean(pkg.scripts?.check && pkg.scripts?.test && pkg.scripts?.["test:coverage"] && pkg.scripts?.["test:e2e"] && pkg.scripts?.["env:check"] && pkg.scripts?.["release:report"] && pkg.scripts?.["release:manifest"] && pkg.scripts?.["storage:inspect"] && pkg.scripts?.["identity:contract"] && pkg.scripts?.["audit:retention"] && pkg.scripts?.["chronic:followup-readiness"] && pkg.scripts?.["data-quality:report"] && pkg.scripts?.["environment:matrix"] && pkg.scripts?.["integration:readiness"] && pkg.scripts?.["interface:mapping"] && pkg.scripts?.["monitoring:readiness"] && pkg.scripts?.["operations:readiness"] && pkg.scripts?.["process:audit"] && pkg.scripts?.["site:pack"] && pkg.scripts?.["production-db:readiness"] && pkg.scripts?.["evaluation:evidence"]), detail: Object.keys(pkg.scripts || {}).join(",") },
    { name: "snapshot:collections", ok: requiredCollections.every((key) => data[key]), detail: requiredCollections.filter((key) => !data[key]).join(",") || "all present" },
    { name: "snapshot:regionalDataSharing", ok: (data.regionalSharingPackages || []).length >= 3 && (data.regionalSharingAccessReviews || []).length >= 1 && serverSource.includes("/api/regional-data-sharing"), detail: `${data.regionalSharingPackages?.length || 0} packages, ${data.regionalSharingAccessReviews?.length || 0} access reviews` },
    { name: "snapshot:interfaceReadiness", ok: p0Interfaces.length >= 4 && p0Interfaces.every((item) => item.id && item.owner && item.status && item.next), detail: `${p0Interfaces.length} P0 interface tracks` },
    { name: "snapshot:securityAcceptance", ok: securityAcceptanceLedger.length >= 4 && securityAcceptanceLedger.every((item) => item.id && item.category && item.owner && item.status && item.next), detail: `${securityAcceptanceLedger.length} security acceptance items` },
    { name: "snapshot:qualitySafety", ok: Array.isArray(data.qualitySafetyEvents) && data.qualitySafetyEvents.length >= 3 && Array.isArray(data.qualityRectificationOrders) && data.qualityRectificationOrders.length >= 1, detail: `${data.qualitySafetyEvents?.length || 0} events, ${data.qualityRectificationOrders?.length || 0} rectifications` },
    { name: "snapshot:chronicFollowupStatusPolicy", ok: Boolean(data.chronicFollowupStatusPolicy?.version && data.chronicFollowupStatusPolicy?.statusGroups?.open && data.chronicFollowupStatusPolicy?.requiredEvidence?.followup), detail: data.chronicFollowupStatusPolicy?.version || "missing" },
    { name: "snapshot:externalDependencyRisks", ok: externalDependencyRiskIds.every((id) => serverSource.includes(id)), detail: `${externalDependencyRiskIds.length} external dependency risks` },
    { name: "snapshot:p2-complete", ok: (data.platformRoadmap || []).filter((item) => item.priority === "P2").every((item) => item.status === "已完成"), detail: (data.platformRoadmap || []).filter((item) => item.priority === "P2").map((item) => `${item.title}:${item.status}`).join(";") },
    { name: "snapshot:accessibility", ok: Array.isArray(data.accessibilityChecklist) && data.accessibilityChecklist.length >= 5, detail: `${data.accessibilityChecklist?.length || 0} checklist items` },
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
