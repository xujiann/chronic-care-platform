#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "operations-readiness-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "operations-readiness-report.md");

const REQUIRED_EXTERNAL_RISKS = [
  "identity-source",
  "institution-systems",
  "insurance-core",
  "certificate-sharing",
  "security-assessment",
  "disaster-recovery"
];

const REQUIRED_OPERATION_ROUTES = [
  "/api/health",
  "/api/metrics",
  "/api/system/readiness",
  "/api/production-operations/center"
];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function arrayOf(data, key) {
  return Array.isArray(data[key]) ? data[key] : [];
}

function seedProductionServiceLevels() {
  return [
    { id: "ops-slo-core-api", name: "核心 API 可用性", scope: "/api/health /api/auth /api/state", target: "monthly availability >= 99.9%", responseTarget: "P1 acknowledge <= 10 minutes", owner: "platform operations", escalation: "operations duty lead -> release manager", status: "policy-defined", productionReady: false },
    { id: "ops-slo-integration", name: "接口交换与回调", scope: "HIS/EMR/LIS/PACS/insurance callbacks", target: "P95 callback <= 5 minutes; dead letter reviewed <= 30 minutes", responseTarget: "P1 acknowledge <= 15 minutes", owner: "integration operations", escalation: "integration lead -> institution owner", status: "policy-defined", productionReady: false },
    { id: "ops-slo-data", name: "数据质量与统计直报", scope: "master index, quality rules, direct-report reconciliation", target: "critical variance closed before submission", responseTarget: "critical quality issue assigned <= 30 minutes", owner: "data operations", escalation: "data owner -> commission statistics", status: "policy-defined", productionReady: false },
    { id: "ops-slo-recovery", name: "备份恢复与回滚", scope: "database, audit, configuration and release artifacts", target: "RPO <= 120 minutes; RTO <= 720 minutes", responseTarget: "rollback owner reachable <= 10 minutes", owner: "backup and recovery operations", escalation: "operations duty lead -> release manager", status: "policy-defined", productionReady: false }
  ];
}

function seedOperationsDutyShifts() {
  return [
    { id: "ops-duty-day", name: "日间运行值守", window: "08:00-20:00", primaryRole: "operations duty engineer", backupRole: "platform operations backup", contactChannel: "onsite duty phone and ticket queue pending", handoffChecklist: ["active alerts", "open incidents", "latest backup id", "planned changes"], status: "roster-template-ready", handoffStatus: "pending", productionReady: false, actionHistory: [] },
    { id: "ops-duty-night", name: "夜间运行值守", window: "20:00-08:00", primaryRole: "night operations duty", backupRole: "infrastructure escalation owner", contactChannel: "onsite duty phone and escalation group pending", handoffChecklist: ["P1/P2 alerts", "batch and callback health", "backup status", "rollback contacts"], status: "roster-template-ready", handoffStatus: "pending", productionReady: false, actionHistory: [] },
    { id: "ops-duty-emergency", name: "应急与发布窗口值守", window: "change or incident window", primaryRole: "release manager", backupRole: "operations duty lead", contactChannel: "command bridge and video room pending", handoffChecklist: ["go/no-go recorder", "change ticket", "rollback decision owner", "incident evidence"], status: "roster-template-ready", handoffStatus: "pending", productionReady: false, actionHistory: [] }
  ];
}

function seedOperationsIncidents() {
  return [
    { id: "ops-incident-api-latency", title: "核心 API 延迟演示告警", severity: "P2", source: "runtime-metrics", status: "open-demo", detectedAt: "2026-07-10T01:00:00.000Z", owner: "operations duty engineer", acknowledgeWithinMinutes: 15, rollbackDecisionOwner: "release manager", evidenceRefs: ["/api/metrics"], productionReady: false, actionHistory: [] },
    { id: "ops-incident-callback", title: "医院回调积压演示事件", severity: "P1", source: "integration-dead-letter", status: "escalation-pending", detectedAt: "2026-07-10T01:15:00.000Z", owner: "integration operations", acknowledgeWithinMinutes: 10, rollbackDecisionOwner: "integration lead", evidenceRefs: ["integration-readiness-report.md"], productionReady: false, actionHistory: [] },
    { id: "ops-incident-backup-proof", title: "远端备份介质证据待现场确认", severity: "P1", source: "disaster-recovery-gate", status: "onsite-pending", detectedAt: "2026-07-10T01:30:00.000Z", owner: "backup and recovery operations", acknowledgeWithinMinutes: 10, rollbackDecisionOwner: "operations duty lead", evidenceRefs: ["storage:assess"], productionReady: false, actionHistory: [] }
  ];
}

function seedDisasterRecoveryDrills() {
  return [
    { id: "ops-drill-backup-restore", name: "数据库与审计备份恢复演练", scenario: "backup-restore", targetRpoMinutes: 120, targetRtoMinutes: 720, measuredRpoMinutes: null, measuredRtoMinutes: null, requiredEvidence: ["backup manifest", "checksum verification", "restore screenshot", "RPO/RTO record", "rollback owner signoff"], checks: [], status: "planned-demo", owner: "backup and recovery operations", productionReady: false, actionHistory: [] },
    { id: "ops-drill-api-rollback", name: "应用发布回滚演练", scenario: "application-rollback", targetRpoMinutes: 0, targetRtoMinutes: 30, measuredRpoMinutes: 0, measuredRtoMinutes: 12, requiredEvidence: ["change ticket", "rollback snapshot", "health smoke", "release manager review"], checks: [{ id: "rollback-snapshot", passed: true }, { id: "health-smoke", passed: true }], status: "validated-demo", owner: "release operations", productionReady: false, actionHistory: [] },
    { id: "ops-drill-identity-fallback", name: "统一认证降级与恢复演练", scenario: "identity-fallback", targetRpoMinutes: 0, targetRtoMinutes: 60, measuredRpoMinutes: null, measuredRtoMinutes: null, requiredEvidence: ["identity source outage ticket", "fallback decision", "session revocation", "recovery confirmation"], checks: [], status: "planned-demo", owner: "identity operations", productionReady: false, actionHistory: [] }
  ];
}

function seedOperationsEvidencePackets() {
  return [
    { id: "ops-evidence-runbook", resource: "all", type: "runbook", reference: "docs/production-operations-run-center.md", note: "运行策略、值班模板和生产边界已建档。", status: "demo-evidence", productionEvidence: false, recordedAt: "2026-07-10T00:00:00.000Z", recordedBy: "platform-seed" },
    { id: "ops-evidence-storage-tools", resource: "drills:ops-drill-backup-restore", type: "tooling", reference: "scripts/storage-admin.js", note: "备份校验、恢复排练和安全恢复工具已纳入发布测试。", status: "demo-evidence", productionEvidence: false, recordedAt: "2026-07-10T00:00:00.000Z", recordedBy: "platform-seed" }
  ];
}

function mergeRows(defaultRows, currentRows, key = "id") {
  const merged = new Map();
  (Array.isArray(defaultRows) ? defaultRows : []).forEach((item) => merged.set(item[key], item));
  (Array.isArray(currentRows) ? currentRows : []).forEach((item) => {
    if (!item?.[key]) return;
    merged.set(item[key], { ...(merged.get(item[key]) || {}), ...item });
  });
  return [...merged.values()];
}

function buildProductionOperationsCenter(data = {}, options = {}) {
  const serviceLevels = mergeRows(seedProductionServiceLevels(), data.productionServiceLevels).map((item) => ({ ...item, productionReady: false }));
  const dutyShifts = mergeRows(seedOperationsDutyShifts(), data.operationsDutyShifts).map((item) => ({ ...item, productionReady: false }));
  const incidents = mergeRows(seedOperationsIncidents(), data.operationsIncidents).map((item) => ({ ...item, productionReady: false }));
  const drills = mergeRows(seedDisasterRecoveryDrills(), data.disasterRecoveryDrills).map((item) => ({ ...item, productionReady: false }));
  const evidencePackets = mergeRows(seedOperationsEvidencePackets(), data.operationsEvidencePackets).map((item) => ({ ...item, productionEvidence: false }));
  const blockers = [
    "signed 24x365 duty roster, phone tree and escalation owners",
    "remote backup target, retention policy and production backup manifest",
    "full-volume restore, failover and rollback rehearsal with measured RPO/RTO",
    "production monitoring, SIEM, paging and ticket channel integration",
    "multi-party disaster-recovery drill report and go-live signoff"
  ];
  const openIncidentStatuses = new Set(["open-demo", "escalation-pending", "onsite-pending", "acknowledged-demo", "escalated-demo", "onsite-requested"]);
  const runtime = options.runtimeMetrics || null;
  return {
    ok: serviceLevels.length >= 4 && dutyShifts.length >= 3 && incidents.length >= 3 && drills.length >= 3 && evidencePackets.length >= 2,
    status: "run-center-ready-onsite-blocked",
    summary: {
      serviceLevels: serviceLevels.length,
      policyDefined: serviceLevels.filter((item) => item.status === "policy-defined").length,
      dutyShifts: dutyShifts.length,
      handoffsRecorded: dutyShifts.filter((item) => item.handoffStatus === "recorded-demo").length,
      incidents: incidents.length,
      openIncidents: incidents.filter((item) => openIncidentStatuses.has(item.status)).length,
      drills: drills.length,
      validatedDrills: drills.filter((item) => item.status === "validated-demo").length,
      evidencePackets: evidencePackets.length,
      productionReady: 0,
      onsiteBlockers: blockers.length
    },
    serviceLevels,
    dutyShifts,
    incidents,
    drills,
    evidencePackets,
    runtime,
    blockers,
    boundary: "Local policies, handoffs, incident actions and recovery rehearsals are operational evidence only. Production operation remains blocked until live monitoring and paging, remote backup, measured full-volume recovery, signed duty rosters and multi-party DR approval are complete."
  };
}

const RUN_ACTIONS = {
  incidents: { acknowledge: "acknowledged-demo", escalate: "escalated-demo", "resolve-demo": "resolved-demo", "request-onsite": "onsite-requested" },
  "duty-shifts": { "record-handoff": "handoff-recorded-demo", "request-onsite": "onsite-requested" },
  drills: { "rehearse-demo": "validated-demo", "record-evidence": "evidence-recorded", "request-onsite": "onsite-requested" }
};

function applyProductionOperationsAction(resource, item, payload = {}, user = {}) {
  const action = String(payload.action || "").trim();
  const note = String(payload.note || "").trim();
  const evidenceRef = String(payload.evidenceRef || "").trim();
  const nextStatus = RUN_ACTIONS[resource]?.[action];
  if (!nextStatus) throw new Error("unsupported production operations action");
  if (!note) throw new Error("production operations action requires note");
  if (action === "record-evidence" && !evidenceRef) throw new Error("production operations evidence action requires evidenceRef");
  const at = new Date().toISOString();
  const actor = user.name || user.username || user.role || "commission";
  const history = { id: randomUUID(), at, action, note, evidenceRef, actor, role: user.role || "commission", fromStatus: item.status || "", toStatus: nextStatus, productionReady: false };
  const updated = {
    ...item,
    status: nextStatus,
    updatedAt: at,
    updatedBy: actor,
    productionReady: false,
    actionHistory: [history, ...(Array.isArray(item.actionHistory) ? item.actionHistory : [])].slice(0, 20)
  };
  if (resource === "duty-shifts" && action === "record-handoff") {
    updated.handoffStatus = "recorded-demo";
    updated.lastHandoffAt = at;
    updated.lastHandoffBy = actor;
  }
  if (resource === "incidents") {
    updated.acknowledgedAt = action === "acknowledge" ? at : item.acknowledgedAt || "";
    updated.resolutionNote = action === "resolve-demo" ? note : item.resolutionNote || "";
  }
  if (resource === "drills" && action === "rehearse-demo") {
    const targetRpo = Number(item.targetRpoMinutes || 120);
    const targetRto = Number(item.targetRtoMinutes || 720);
    updated.measuredRpoMinutes = Number(payload.measuredRpoMinutes ?? Math.min(targetRpo, 18));
    updated.measuredRtoMinutes = Number(payload.measuredRtoMinutes ?? Math.min(targetRto, 42));
    updated.checks = [
      { id: "manifest-checksum", passed: true },
      { id: "isolated-restore-sample", passed: true },
      { id: "health-smoke", passed: true },
      { id: "rollback-owner-recorded", passed: false, reason: "onsite signoff pending" }
    ];
    updated.rehearsalDigest = createHash("sha256").update(`${item.id}:${at}:${updated.measuredRpoMinutes}:${updated.measuredRtoMinutes}`).digest("hex");
  }
  const evidencePacket = action === "record-evidence" || action === "rehearse-demo" ? {
    id: randomUUID(),
    resource: `${resource}:${item.id}`,
    type: action === "rehearse-demo" ? "local-rehearsal" : "operator-evidence-reference",
    reference: evidenceRef || `runtime-rehearsal:${updated.rehearsalDigest}`,
    note,
    status: "pending-onsite-validation",
    productionEvidence: false,
    recordedAt: at,
    recordedBy: actor
  } : null;
  return { item: updated, history, evidencePacket };
}

function buildOperationsReadinessReport(options = {}) {
  const data = options.data ?? readJson("data/db.json");
  const pkg = options.pkg ?? readJson("package.json");
  const serverSource = options.serverSource ?? readText("server.js");
  const readme = options.readme ?? readText("README.md");
  const deployment = options.deployment ?? readText("DEPLOYMENT.md");
  const operationsSource = options.operationsSource ?? readText("operations.js");
  const operationsHtml = options.operationsHtml ?? readText("operations.html");
  const documentation = options.documentation ?? readText(path.join("docs", "production-operations-run-center.md"));
  const productionDeploymentPlan = arrayOf(data, "productionDeploymentPlan");
  const securityAcceptanceLedger = arrayOf(data, "securityAcceptanceLedger");
  const interfaceRows = arrayOf(data, "platformInterfaces");
  const operationRoutes = REQUIRED_OPERATION_ROUTES.map((route) => ({
    route,
    present: serverSource.includes(route),
    documented: readme.includes(route) || deployment.includes(route) || documentation.includes(route)
  }));
  const externalDependencies = REQUIRED_EXTERNAL_RISKS.map((id) => ({
    id,
    present: serverSource.includes(id),
    documented: readme.includes(id) || deployment.includes(id) || serverSource.includes(id)
  }));
  const productionTracks = productionDeploymentPlan.map((item) => ({
    id: item.id,
    track: item.track,
    owner: item.owner,
    status: item.status,
    ready: Boolean(item.id && item.track && item.owner && item.status && item.nextAction && Array.isArray(item.requiredConfig) && item.requiredConfig.length)
  }));
  const requiredScripts = [
    "env:check:production",
    "release:report",
    "deploy:check",
    "storage:assess",
    "rollback:snapshot",
    "audit:retention",
    "data-quality:report",
    "integration:readiness",
    "evaluation:evidence"
  ];
  const runCenter = buildProductionOperationsCenter(data, options);
  const checks = [
    { id: "operations:routes", passed: operationRoutes.every((item) => item.present && item.documented), detail: operationRoutes.map((item) => `${item.route}:${item.present ? "code" : "missing"}/${item.documented ? "docs" : "undoc"}`).join(";") },
    { id: "operations:runtimeMetrics", passed: /buildRuntimeMetrics/.test(serverSource) && /workload/.test(serverSource) && /dataQualityIssues/.test(serverSource), detail: "runtime metrics include workload and data quality counters" },
    { id: "operations:systemReadiness", passed: /buildSystemReadinessReport/.test(serverSource) && /externalDependencySummary/.test(serverSource), detail: "system readiness includes external dependency summary" },
    { id: "operations:productionTracks", passed: productionTracks.length >= 4 && productionTracks.every((item) => item.ready), detail: `${productionTracks.length} production deployment tracks` },
    { id: "operations:externalDependencies", passed: externalDependencies.every((item) => item.present), detail: externalDependencies.map((item) => `${item.id}:${item.present ? "yes" : "no"}`).join(";") },
    { id: "operations:securityAcceptance", passed: securityAcceptanceLedger.length >= 4 && securityAcceptanceLedger.every((item) => item.id && item.category && item.owner && item.status && item.next), detail: `${securityAcceptanceLedger.length} security acceptance rows` },
    { id: "operations:p0InterfaceOwners", passed: interfaceRows.filter((item) => item.priority === "P0").every((item) => item.owner && item.status && item.next), detail: `${interfaceRows.filter((item) => item.priority === "P0").length} P0 interface rows` },
    { id: "operations:releaseScripts", passed: requiredScripts.every((name) => pkg.scripts?.[name]), detail: requiredScripts.filter((name) => !pkg.scripts?.[name]).join(",") || "all required operation scripts present" },
    { id: "operations:deploymentDocs", passed: /productionDeploymentPlan/.test(deployment) && /release:report/.test(deployment) && /data-quality:report/.test(deployment), detail: "deployment document includes release, data quality, and production plan evidence" },
    { id: "operations:runCenterModel", passed: runCenter.ok && runCenter.summary.serviceLevels >= 4 && runCenter.summary.dutyShifts >= 3 && runCenter.summary.incidents >= 3 && runCenter.summary.drills >= 3, detail: `${runCenter.summary.serviceLevels} SLOs / ${runCenter.summary.dutyShifts} duty shifts / ${runCenter.summary.incidents} incidents / ${runCenter.summary.drills} drills` },
    { id: "operations:recoveryBoundary", passed: runCenter.summary.productionReady === 0 && runCenter.summary.onsiteBlockers >= 5 && runCenter.drills.every((item) => item.productionReady === false), detail: `production ready 0 / ${runCenter.summary.validatedDrills} local drills / ${runCenter.summary.onsiteBlockers} onsite blockers` },
    { id: "operations:runCenterApi", passed: ["/api/production-operations/center", "production-operations-action"].every((marker) => serverSource.includes(marker)), detail: "commission run-center API and audited actions are wired" },
    { id: "operations:runCenterUi", passed: operationsHtml.includes("production-operations-run-center") && operationsSource.includes("renderProductionOperationsCenter") && operationsSource.includes("data-production-operations-action"), detail: "operations page exposes the production run center and actions" },
    { id: "operations:runCenterDocs", passed: ["RPO", "RTO", "24x365", "Production approval", "/api/production-operations/center"].every((marker) => documentation.includes(marker)), detail: "SLO, duty, incident, recovery and production boundaries are documented" }
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    operationRoutes,
    externalDependencies,
    productionTracks,
    securityAcceptanceLedger,
    runCenter,
    requiredScripts,
    checks
  };
}

function renderMarkdown(report) {
  const checkRows = report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${String(item.detail || "").replace(/\|/g, "/")} |`);
  const routeRows = report.operationRoutes.map((item) => `| ${item.present && item.documented ? "PASS" : "FAIL"} | ${item.route} | ${item.present ? "yes" : "no"} | ${item.documented ? "yes" : "no"} |`);
  const dependencyRows = report.externalDependencies.map((item) => `| ${item.present ? "TRACKED" : "MISSING"} | ${item.id} | ${item.documented ? "yes" : "no"} |`);
  const trackRows = report.productionTracks.map((item) => `| ${item.ready ? "PASS" : "FAIL"} | ${item.id} | ${item.track || ""} | ${item.owner || ""} | ${item.status || ""} |`);
  const serviceRows = report.runCenter.serviceLevels.map((item) => `| ${item.name} | ${item.target} | ${item.responseTarget} | ${item.owner} | no |`);
  const drillRows = report.runCenter.drills.map((item) => `| ${item.name} | ${item.status} | ${item.targetRpoMinutes} | ${item.targetRtoMinutes} | ${item.measuredRpoMinutes ?? "-"} | ${item.measuredRtoMinutes ?? "-"} | no |`);
  return [
    "# Operations readiness report",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    "",
    "## Checks",
    "",
    "| Result | Check | Detail |",
    "|---|---|---|",
    ...checkRows,
    "",
    "## Operation routes",
    "",
    "| Result | Route | Code | Docs |",
    "|---|---|---|---|",
    ...routeRows,
    "",
    "## External dependency risks",
    "",
    "| Status | Risk | Documented |",
    "|---|---|---|",
    ...dependencyRows,
    "",
    "## Production deployment tracks",
    "",
    "| Result | ID | Track | Owner | Status |",
    "|---|---|---|---|---|",
    ...trackRows,
    "",
    "## Production operations run center",
    "",
    `- Status: ${report.runCenter.status}`,
    `- Duty shifts: ${report.runCenter.summary.dutyShifts}`,
    `- Open incidents: ${report.runCenter.summary.openIncidents}`,
    `- Validated local drills: ${report.runCenter.summary.validatedDrills}`,
    `- Production ready: ${report.runCenter.summary.productionReady}`,
    "",
    "### Service levels",
    "",
    "| Service | Target | Response | Owner | Production ready |",
    "|---|---|---|---|---|",
    ...serviceRows,
    "",
    "### Recovery drills",
    "",
    "| Drill | Status | Target RPO | Target RTO | Measured RPO | Measured RTO | Production ready |",
    "|---|---|---|---|---|---|---|",
    ...drillRows,
    "",
    "### Production boundary",
    "",
    report.runCenter.boundary,
    "",
    ...report.runCenter.blockers.map((item) => `- ${item}`),
    ""
  ].join("\n");
}

function parseArgs(argv = process.argv.slice(2)) {
  const flags = {};
  argv.forEach((flag) => {
    if (!flag.startsWith("--")) return;
    const [key, ...rest] = flag.slice(2).split("=");
    flags[key] = rest.length ? rest.join("=") : true;
  });
  return flags;
}

function writeOutput(report, flags = {}) {
  const output = path.resolve(ROOT, String(flags.output || DEFAULT_OUTPUT));
  const markdown = path.resolve(ROOT, String(flags.markdown || DEFAULT_MARKDOWN));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2), "utf8");
  fs.mkdirSync(path.dirname(markdown), { recursive: true });
  fs.writeFileSync(markdown, renderMarkdown(report), "utf8");
}

function runCli() {
  const flags = parseArgs();
  const report = buildOperationsReadinessReport();
  if (flags.write !== false) writeOutput(report, flags);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  applyProductionOperationsAction,
  buildOperationsReadinessReport,
  buildProductionOperationsCenter,
  parseArgs,
  renderMarkdown,
  seedDisasterRecoveryDrills,
  seedOperationsDutyShifts,
  seedOperationsEvidencePackets,
  seedOperationsIncidents,
  seedProductionServiceLevels,
  writeOutput
};
