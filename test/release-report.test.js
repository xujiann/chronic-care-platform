const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { buildReleaseReport, parseArgs, renderCutoverMarkdown, renderMarkdown, renderServiceAcceptanceMarkdown, renderStorageModelMarkdown, validateProductionConfig, writeOutput } = require("../scripts/release-report");

const ROOT = path.resolve(__dirname, "..");

test("release report validates demo and production environment profiles", () => {
  const demo = validateProductionConfig({
    profile: "demo",
    env: {
      NODE_ENV: "production",
      STORAGE_ENGINE: "auto",
      SESSION_SECRETS: "replace-with-long-random-secret",
      INTEGRATION_GATEWAY_SECRET: "replace-with-integration-secret"
    }
  });
  assert.equal(demo.passed, true);
  assert.equal(demo.checks.some((item) => item.name === "env:SESSION_SECRETS.productionQuality" && item.severity === "warn"), true);

  const failedProduction = validateProductionConfig({
    profile: "production",
    env: {
      NODE_ENV: "production",
      STORAGE_ENGINE: "json",
      SESSION_SECRETS: "replace-with-long-random-secret",
      INTEGRATION_GATEWAY_SECRET: "demo-secret"
    }
  });
  assert.equal(failedProduction.passed, false);
  assert.equal(failedProduction.checks.some((item) => item.name === "env:STORAGE_ENGINE.production" && !item.passed), true);
  assert.equal(failedProduction.checks.some((item) => item.name === "env:SESSION_SECRETS.productionQuality" && !item.passed), true);
  assert.equal(failedProduction.cutoverChecklist.some((item) => item.id === "cutover-secrets" && !item.passed), true);
  assert.equal(failedProduction.cutoverChecklist.some((item) => item.id === "cutover-identity" && !item.passed), true);

  const postgresBeforeAdapter = validateProductionConfig({
    profile: "production",
    env: {
      NODE_ENV: "production",
      STORAGE_ENGINE: "postgres",
      DATABASE_URL: "postgres://health:secret@example.internal:5432/health",
      SESSION_SECRETS: "0123456789abcdef0123456789abcdef",
      INTEGRATION_GATEWAY_SECRET: "fedcba9876543210fedcba9876543210",
      OIDC_ISSUER_URL: "https://identity.example.internal",
      OIDC_CLIENT_ID: "health-platform",
      OIDC_CLIENT_SECRET: "abcdef0123456789abcdef0123456789",
      AUDIT_EXPORT_PATH: "/var/log/chronic-care-platform/audit"
    }
  });
  assert.equal(postgresBeforeAdapter.passed, false);
  assert.equal(postgresBeforeAdapter.checks.some((item) => item.name === "env:STORAGE_ENGINE.runtimeAdapter" && !item.passed), true);

  const production = validateProductionConfig({
    profile: "production",
    env: {
      NODE_ENV: "production",
      STORAGE_ENGINE: "sqlite",
      SESSION_SECRETS: "0123456789abcdef0123456789abcdef,abcdef0123456789abcdef0123456789",
      INTEGRATION_GATEWAY_SECRET: "fedcba9876543210fedcba9876543210",
      OIDC_ISSUER_URL: "https://identity.example.internal",
      OIDC_CLIENT_ID: "health-platform",
      OIDC_CLIENT_SECRET: "abcdef0123456789abcdef0123456789",
      AUDIT_EXPORT_PATH: "/var/log/chronic-care-platform/audit"
    }
  });
  assert.equal(production.passed, true);
  assert.equal(production.cutoverChecklist.some((item) => item.id === "cutover-identity" && item.passed), true);
  assert.equal(production.cutoverChecklist.some((item) => item.id === "cutover-audit-retention" && item.passed), true);
  assert.equal(production.cutoverChecklist.some((item) => item.id === "cutover-institution-interfaces" && !item.passed), true);
  assert.equal(production.cutoverChecklist.some((item) => item.id === "cutover-monitoring" && /missing site signoff/.test(item.evidence)), true);

  const missingEnvFile = validateProductionConfig({
    profile: "production",
    envFile: ".env.missing"
  });
  assert.equal(missingEnvFile.passed, false);
  assert.equal(missingEnvFile.checks.some((item) => item.name === "env:file" && !item.passed), true);
});

test("release report summarizes repository readiness and renders markdown", () => {
  const report = buildReleaseReport({
    profile: "demo",
    env: {
      NODE_ENV: "production",
      STORAGE_ENGINE: "auto",
      SESSION_SECRETS: "replace-with-long-random-secret",
      INTEGRATION_GATEWAY_SECRET: "replace-with-integration-secret"
    }
  });
  assert.equal(report.ok, true);
  assert.equal(report.summary.failed, 0);
  assert.equal(report.checks.some((item) => item.name === "package:scripts" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "snapshot:acceptanceEvidence" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "snapshot:securityAcceptance" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "snapshot:productionDeploymentPlan" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "snapshot:interfaceReadiness" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "snapshot:externalDependencyRisks" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "storage:jsonSnapshot.present" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "storage:jsonSnapshot.collections" && item.passed), true);
  assert.equal(report.storageModel.jsonSnapshot.present, true);
  assert.equal(report.storageModel.jsonSnapshot.collections >= 40, true);
  assert.equal(report.checks.some((item) => item.name === "identity:contract" && item.passed), true);
  assert.equal(report.identityContract.ok, true);
  assert.equal(report.checks.some((item) => item.name === "audit:retention" && item.passed), true);
  assert.equal(report.auditRetention.ok, true);
  assert.equal(report.checks.some((item) => item.name === "dataQuality:report" && item.passed), true);
  assert.equal(report.dataQuality.ok, true);
  assert.equal(report.checks.some((item) => item.name === "integration:readiness" && item.passed), true);
  assert.equal(report.integrationReadiness.ok, true);
  assert.equal(report.checks.some((item) => item.name === "interfaceMapping:report" && item.passed), true);
  assert.equal(report.interfaceMapping.ok, true);
  assert.equal(report.checks.some((item) => item.name === "monitoring:readiness" && item.passed), true);
  assert.equal(report.monitoringReadiness.ok, true);
  assert.equal(report.checks.some((item) => item.name === "operations:readiness" && item.passed), true);
  assert.equal(report.operationsReadiness.ok, true);
  assert.equal(report.checks.some((item) => item.name === "process:audit" && item.passed), true);
  assert.equal(report.processAudit.ok, true);
  assert.equal(report.checks.some((item) => item.name === "service:chronicDomains" && item.passed), true);
  assert.equal(report.checks.some((item) => item.name === "service:countyDomains" && item.passed), true);
  assert.equal(report.serviceAcceptance.chronic.summary.domains, 8);
  assert.equal(report.serviceAcceptance.county.summary.domains, 5);
  assert.equal(report.serviceAcceptance.chronic.openActions.some((item) => item.id === "cst-001" && item.collection === "chronicScreeningTasks"), true);
  assert.equal(report.serviceAcceptance.county.openActions.some((item) => item.id === "cco-001" && item.collection === "countyCollaborationOrders"), true);
  assert.equal(report.serviceAcceptance.chronic.openActions.find((item) => item.id === "cst-001").priority, "high");
  assert.equal(report.serviceAcceptance.county.openActions.find((item) => item.id === "cco-001").priority, "high");
  assert.equal(report.checks.some((item) => item.name === "sitePack:readiness" && item.passed), true);
  assert.equal(report.siteReadinessPack.ok, true);
  assert.equal(report.checks.some((item) => item.name === "productionDb:readiness" && item.passed), true);
  assert.equal(report.productionDbReadiness.ok, true);
  assert.equal(report.checks.some((item) => item.name === "evaluation:evidence" && item.passed), true);
  assert.equal(report.evaluationEvidence.ok, true);
  assert.equal(report.checks.some((item) => item.name === "environment:matrix" && item.passed), true);
  assert.equal(report.environmentMatrix.ok, true);
  assert.equal(report.environmentMatrix.profiles.some((item) => item.id === "staging"), true);
  assert.equal(report.productionCutover.some((item) => item.id === "cutover-env-file"), true);
  assert.equal(report.productionCutover.some((item) => item.id === "cutover-institution-interfaces" && !item.passed), true);
  assert.equal(report.productionCutover.some((item) => item.id === "cutover-insurance-certificate" && !item.passed), true);
  assert.equal(report.productionCutover.some((item) => item.id === "cutover-monitoring" && !item.passed), true);
  assert.equal(report.productionCutover.some((item) => item.id === "cutover-dr-rehearsal" && !item.passed), true);

  const markdown = renderMarkdown(report);
  assert.match(markdown, /Release readiness report/);
  assert.match(markdown, /Production cutover checklist/);
  assert.match(markdown, /Storage model inspection/);
  assert.match(markdown, /Identity integration contract/);
  assert.match(markdown, /Audit retention report/);
  assert.match(markdown, /Integration readiness report/);
  assert.match(markdown, /Interface mapping report/);
  assert.match(markdown, /Data quality and master index report/);
  assert.match(markdown, /Monitoring readiness report/);
  assert.match(markdown, /Operations readiness report/);
  assert.match(markdown, /Full process audit report/);
  assert.match(markdown, /Service acceptance summary/);
  assert.match(markdown, /service:chronicDomains/);
  assert.match(markdown, /Service open action preview/);
  assert.match(markdown, /cst-001/);
  assert.match(markdown, /Site readiness pack/);
  assert.match(markdown, /Production database readiness report/);
  assert.match(markdown, /Interoperability evaluation evidence report/);
  assert.match(markdown, /Environment matrix report/);
  assert.match(markdown, /Release artifact manifest/);
  assert.match(markdown, /cutover-identity/);
  assert.match(markdown, /snapshot:acceptanceEvidence/);
  assert.match(markdown, /snapshot:securityAcceptance/);
  assert.match(markdown, /snapshot:productionDeploymentPlan/);
  assert.match(markdown, /snapshot:interfaceReadiness/);
  assert.match(markdown, /snapshot:externalDependencyRisks/);

  const cutoverMarkdown = renderCutoverMarkdown(report);
  assert.match(cutoverMarkdown, /Production cutover checklist/);
  assert.match(cutoverMarkdown, /cutover-audit-retention/);
  assert.match(cutoverMarkdown, /cutover-institution-interfaces/);
  assert.match(cutoverMarkdown, /missing site signoff/);

  const signedReport = buildReleaseReport({
    profile: "demo",
    env: {
      NODE_ENV: "production",
      STORAGE_ENGINE: "auto",
      SESSION_SECRETS: "replace-with-long-random-secret",
      INTEGRATION_GATEWAY_SECRET: "replace-with-integration-secret",
      CUTOVER_SITE_INTERFACE_SIGNOFF: "signed",
      CUTOVER_INSURANCE_CERTIFICATE_SIGNOFF: "signed",
      CUTOVER_MONITORING_SIGNOFF: "signed",
      CUTOVER_DR_REHEARSAL_SIGNOFF: "signed"
    }
  });
  assert.equal(signedReport.productionCutover.some((item) => item.id === "cutover-institution-interfaces" && item.passed), true);
  assert.equal(signedReport.productionCutover.some((item) => item.id === "cutover-monitoring" && item.passed), true);

  const storageMarkdown = renderStorageModelMarkdown(report);
  assert.match(storageMarkdown, /Storage model inspection/);
  assert.match(storageMarkdown, /JSON snapshot/);
  assert.match(storageMarkdown, /SQLite store/);

  const serviceMarkdown = renderServiceAcceptanceMarkdown(report);
  assert.match(serviceMarkdown, /Service acceptance summary/);
  assert.match(serviceMarkdown, /Chronic domains: 8\/8 modeled/);
  assert.match(serviceMarkdown, /County domains: 5\/5 modeled/);
  assert.match(serviceMarkdown, /Open action preview/);
  assert.match(serviceMarkdown, /cco-001/);
  assert.match(serviceMarkdown, /\| chronic \| high \| chronicScreeningTasks \| cst-001/);
});

test("release report writes standalone production cutover and storage artifacts", (t) => {
  const outputDir = path.join(ROOT, "tmp", "release-report-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const report = buildReleaseReport({
    profile: "demo",
    env: {
      NODE_ENV: "production",
      STORAGE_ENGINE: "auto",
      SESSION_SECRETS: "replace-with-long-random-secret",
      INTEGRATION_GATEWAY_SECRET: "replace-with-integration-secret"
    }
  });

  writeOutput(report, {
    output: path.join("tmp", "release-report-test", "release-report.json"),
    markdown: path.join("tmp", "release-report-test", "release-report.md")
  });

  const cutoverJson = JSON.parse(fs.readFileSync(path.join(outputDir, "production-cutover-checklist.json"), "utf8"));
  const cutoverMarkdown = fs.readFileSync(path.join(outputDir, "production-cutover-checklist.md"), "utf8");
  const storageJson = JSON.parse(fs.readFileSync(path.join(outputDir, "storage-model-inspection.json"), "utf8"));
  const storageMarkdown = fs.readFileSync(path.join(outputDir, "storage-model-inspection.md"), "utf8");
  const identityJson = JSON.parse(fs.readFileSync(path.join(outputDir, "identity-contract.json"), "utf8"));
  const identityMarkdown = fs.readFileSync(path.join(outputDir, "identity-contract.md"), "utf8");
  const auditJson = JSON.parse(fs.readFileSync(path.join(outputDir, "audit-retention-report.json"), "utf8"));
  const auditMarkdown = fs.readFileSync(path.join(outputDir, "audit-retention-report.md"), "utf8");
  const dataQualityJson = JSON.parse(fs.readFileSync(path.join(outputDir, "data-quality-report.json"), "utf8"));
  const dataQualityMarkdown = fs.readFileSync(path.join(outputDir, "data-quality-report.md"), "utf8");
  const integrationJson = JSON.parse(fs.readFileSync(path.join(outputDir, "integration-readiness-report.json"), "utf8"));
  const integrationMarkdown = fs.readFileSync(path.join(outputDir, "integration-readiness-report.md"), "utf8");
  const interfaceMappingJson = JSON.parse(fs.readFileSync(path.join(outputDir, "interface-mapping-report.json"), "utf8"));
  const interfaceMappingMarkdown = fs.readFileSync(path.join(outputDir, "interface-mapping-report.md"), "utf8");
  const monitoringJson = JSON.parse(fs.readFileSync(path.join(outputDir, "monitoring-readiness-report.json"), "utf8"));
  const monitoringMarkdown = fs.readFileSync(path.join(outputDir, "monitoring-readiness-report.md"), "utf8");
  const operationsJson = JSON.parse(fs.readFileSync(path.join(outputDir, "operations-readiness-report.json"), "utf8"));
  const operationsMarkdown = fs.readFileSync(path.join(outputDir, "operations-readiness-report.md"), "utf8");
  const processAuditJson = JSON.parse(fs.readFileSync(path.join(outputDir, "process-audit-report.json"), "utf8"));
  const processAuditMarkdown = fs.readFileSync(path.join(outputDir, "process-audit-report.md"), "utf8");
  const serviceAcceptanceJson = JSON.parse(fs.readFileSync(path.join(outputDir, "service-acceptance-summary.json"), "utf8"));
  const serviceAcceptanceMarkdown = fs.readFileSync(path.join(outputDir, "service-acceptance-summary.md"), "utf8");
  const siteReadinessJson = JSON.parse(fs.readFileSync(path.join(outputDir, "site-readiness-pack.json"), "utf8"));
  const siteReadinessMarkdown = fs.readFileSync(path.join(outputDir, "site-readiness-pack.md"), "utf8");
  const identityTemplateReadme = fs.readFileSync(path.join(outputDir, "templates", "identity-source-mapping", "README.md"), "utf8");
  const interfaceTemplateReadme = fs.readFileSync(path.join(outputDir, "templates", "interface-joint-test", "README.md"), "utf8");
  const monitoringTemplateReadme = fs.readFileSync(path.join(outputDir, "templates", "monitoring-on-call", "README.md"), "utf8");
  const signoffTemplateReadme = fs.readFileSync(path.join(outputDir, "templates", "production-signoff", "README.md"), "utf8");
  const productionDbJson = JSON.parse(fs.readFileSync(path.join(outputDir, "production-db-readiness-report.json"), "utf8"));
  const productionDbMarkdown = fs.readFileSync(path.join(outputDir, "production-db-readiness-report.md"), "utf8");
  const evaluationJson = JSON.parse(fs.readFileSync(path.join(outputDir, "evaluation-evidence-report.json"), "utf8"));
  const evaluationMarkdown = fs.readFileSync(path.join(outputDir, "evaluation-evidence-report.md"), "utf8");
  const environmentJson = JSON.parse(fs.readFileSync(path.join(outputDir, "environment-matrix-report.json"), "utf8"));
  const environmentMarkdown = fs.readFileSync(path.join(outputDir, "environment-matrix-report.md"), "utf8");
  const healthDashboardJson = JSON.parse(fs.readFileSync(path.join(outputDir, "health-dashboard-summary.json"), "utf8"));
  const healthDashboardMarkdown = fs.readFileSync(path.join(outputDir, "health-dashboard-summary.md"), "utf8");
  const manifestJson = JSON.parse(fs.readFileSync(path.join(outputDir, "release-artifact-manifest.json"), "utf8"));
  const manifestMarkdown = fs.readFileSync(path.join(outputDir, "release-artifact-manifest.md"), "utf8");
  assert.equal(cutoverJson.checklist.some((item) => item.id === "cutover-identity"), true);
  assert.match(cutoverMarkdown, /cutover-storage-adapter/);
  assert.equal(storageJson.storageModel.jsonSnapshot.present, true);
  assert.match(storageMarkdown, /Storage model inspection/);
  assert.match(storageMarkdown, /Largest/);
  assert.equal(identityJson.identityContract.ok, true);
  assert.match(identityMarkdown, /Required external claims/);
  assert.equal(auditJson.auditRetention.ok, true);
  assert.match(auditMarkdown, /Audit chains/);
  assert.equal(dataQualityJson.dataQuality.ok, true);
  assert.match(dataQualityMarkdown, /Resident-linked collections/);
  assert.equal(integrationJson.integrationReadiness.ok, true);
  assert.match(integrationMarkdown, /P0 coverage/);
  assert.equal(interfaceMappingJson.interfaceMapping.ok, true);
  assert.match(interfaceMappingMarkdown, /Contract field mappings/);
  assert.equal(monitoringJson.monitoringReadiness.ok, true);
  assert.match(monitoringMarkdown, /SLO targets/);
  assert.equal(operationsJson.operationsReadiness.ok, true);
  assert.match(operationsMarkdown, /External dependency risks/);
  assert.equal(processAuditJson.processAudit.ok, true);
  assert.match(processAuditMarkdown, /Full process audit report/);
  assert.equal(serviceAcceptanceJson.serviceAcceptance.ok, true);
  assert.equal(serviceAcceptanceJson.serviceAcceptance.chronic.openActions.some((item) => item.id === "cst-001"), true);
  assert.match(serviceAcceptanceMarkdown, /Service acceptance summary/);
  assert.match(serviceAcceptanceMarkdown, /Open action preview/);
  assert.equal(siteReadinessJson.siteReadinessPack.ok, true);
  assert.match(siteReadinessMarkdown, /Site signoff template/);
  assert.match(identityTemplateReadme, /Identity source mapping template/);
  assert.match(interfaceTemplateReadme, /Interface joint-test template/);
  assert.match(monitoringTemplateReadme, /Monitoring and on-call template/);
  assert.match(signoffTemplateReadme, /Production cutover signoff template/);
  assert.equal(productionDbJson.productionDbReadiness.ok, true);
  assert.match(productionDbMarkdown, /Production database readiness report/);
  assert.equal(evaluationJson.evaluationEvidence.ok, true);
  assert.match(evaluationMarkdown, /Artifact coverage/);
  assert.equal(environmentJson.environmentMatrix.ok, true);
  assert.match(environmentMarkdown, /Environment matrix report/);
  assert.equal(healthDashboardJson.healthDashboard.functionalReport.functions.length, 13);
  assert.equal(healthDashboardJson.healthDashboard.functionalReport.functions.some((item) => item.id === "jurisdiction-workbench"), true);
  assert.equal(healthDashboardJson.healthDashboard.functionalReport.functions.some((item) => item.id === "jurisdiction-scope-drilldown"), true);
  assert.equal(healthDashboardJson.healthDashboard.functionalReport.functions.some((item) => item.id === "task-closure-trend"), true);
  assert.equal(healthDashboardJson.healthDashboard.functionalReport.functions.some((item) => item.id === "department-workbench"), true);
  assert.equal(healthDashboardJson.healthDashboard.siteIssueLedger.items.length >= 1, true);
  assert.equal(healthDashboardJson.healthDashboard.checks.some((item) => item.id === "dashboard:site-issue-ledger" && item.passed), true);
  assert.equal(healthDashboardJson.healthDashboard.jurisdictionScope.districts.length >= 2, true);
  assert.equal(healthDashboardJson.healthDashboard.jurisdictionScope.districts.some((item) => item.id !== "all" && (item.institutionsList.length || item.serviceReportList.length || item.actionList.length)), true);
  assert.equal(healthDashboardJson.healthDashboard.actionClosureTrend.periods.length, 4);
  assert.equal(healthDashboardJson.healthDashboard.actionClosureTrend.summary.total >= healthDashboardJson.healthDashboard.openActions.length, true);
  assert.equal(healthDashboardJson.healthDashboard.populationServiceBoard.sourceDetails.length, 4);
  assert.equal(healthDashboardJson.healthDashboard.functionalReport.departmentFunctionMatrix.length >= 6, true);
  assert.equal(healthDashboardJson.healthDashboard.functionalReport.cityCountyFunctionMatrix.length >= 4, true);
  assert.equal(healthDashboardJson.healthDashboard.functionalReport.cityCountyFunctionMatrix.every((item) => /卫生健康|行政部门|卫健/.test(item.agency)), true);
  assert.equal(healthDashboardJson.healthDashboard.riskDrilldowns.items.length >= 4, true);
  assert.equal(healthDashboardJson.healthDashboard.siteEvidencePackage.items.length, 4);
  assert.match(healthDashboardMarkdown, /主要功能报告/);
  assert.match(healthDashboardMarkdown, /内部机构功能矩阵/);
  assert.match(healthDashboardMarkdown, /市县两级机构功能矩阵/);
  assert.match(healthDashboardMarkdown, /风险下钻/);
  assert.match(healthDashboardMarkdown, /现场验收证据包/);
  assert.match(healthDashboardMarkdown, /发布证据/);
  assert.equal(manifestJson.releaseArtifactManifest.ok, true);
  assert.equal(manifestJson.releaseArtifactManifest.artifacts.some((item) => item.id === "service-acceptance"), true);
  assert.match(manifestMarkdown, /Release artifact manifest/);
  assert.match(manifestMarkdown, /service-acceptance-summary\.md/);
  assert.match(manifestMarkdown, /release\/templates\/identity-source-mapping\/README\.md/);
});

test("release report CLI argument parser keeps command and flags", () => {
  const parsed = parseArgs(["report", "--profile=production", "--config-env=.env", "--run-commands"]);
  assert.equal(parsed.command, "report");
  assert.equal(parsed.flags.profile, "production");
  assert.equal(parsed.flags["config-env"], ".env");
  assert.equal(parsed.flags["run-commands"], true);
});
