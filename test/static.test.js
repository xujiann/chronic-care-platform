const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

test("role pages keep explicit page guards", () => {
  const guards = {
    "citizen.html": "citizen",
    "mobile-preview.html": "citizen",
    "institution.html": "institution",
    "insurance.html": "insurance",
    "county.html": "county",
    "index.html": "commission",
    "platform.html": "commission",
    "workbench.html": "commission"
  };
  Object.entries(guards).forEach(([file, role]) => {
    assert.match(read(file), new RegExp(`requireRole\\(\\[\\"${role}\\"\\]\\)`), `${file} 缺少 ${role} 页面守卫`);
  });
});

test("citizen pages do not expose cross-role module links or management collections", () => {
  const citizenHtml = `${read("citizen.html")}\n${read("mobile-preview.html")}`;
  ["institution.html", "insurance.html", "county.html", "index.html", "platform.html", "workbench.html"].forEach((target) => {
    assert.doesNotMatch(citizenHtml, new RegExp(`href=[\\"']\\./${target}`), `居民页面不应链接到 ${target}`);
  });

  const citizenAssets = `${citizenHtml}\n${read("citizen.js")}`;
  ["authUsers", "securityEvents", "applicationCatalog", "institutionCreditEvaluations", "securityAcceptanceLedger"].forEach((key) => {
    assert.doesNotMatch(citizenAssets, new RegExp(`\\b${key}\\b`), `居民端资产不应依赖管理集合 ${key}`);
  });
});

test("application pages avoid placeholder navigation", () => {
  const pages = ["about.html", "drug-consumable-about.html", "citizen.html", "mobile-preview.html", "institution.html", "insurance.html", "county.html", "index.html", "platform.html", "workbench.html"];
  pages.forEach((file) => assert.doesNotMatch(read(file), /href=["']#["']/, `${file} 存在空链接占位`));
});

test("about page documents runnable platform capabilities", () => {
  const about = read("about.html");
  const auth = read("auth.js");
  assert.match(about, /data-about-section="runtime-capabilities"/);
  assert.match(about, /data-about-section="role-portals"/);
  assert.match(about, /id="policy-source-rules"/);
  assert.match(about, /data-about-section="policy-source-rules"/);
  assert.match(about, /drug-consumable-about\.html/);
  assert.match(about, /医保发〔2025〕7号/);
  assert.match(about, /NMPAB\/T 1011-2022/);
  assert.match(about, /https:\/\/www\.nhsa\.gov\.cn\/art\/2025\/3\/19\/art_104_16045\.html/);
  assert.match(about, /https:\/\/www\.nmpa\.gov\.cn\/directory\/web\/nmpa\/images\/1656320881524098380\.pdf/);
  assert.match(about, /data-about-capability="service-acceptance"/);
  assert.match(about, /data-about-capability="site-template-readmes"/);
  assert.match(about, /data-about-capability="workflow-tasks"/);
  assert.match(about, /data-about-capability="chronic-care"/);
  assert.match(about, /data-about-capability="county-consortium"/);
  assert.match(about, /\/api\/service-acceptance-summary/);
  assert.match(about, /\/api\/site-template-readmes/);
  assert.match(about, /\/api\/tasks/);
  assert.match(about, /npm run deploy:check/);
  assert.match(read("index.html"), /href="\.\/about\.html"/);
  assert.match(read("platform.html"), /href="\.\/about\.html"/);
  assert.match(read("health-city.html"), /href="\.\/about\.html"/);
  assert.match(auth, /\["about\.html", "关于"\]/);
  assert.match(auth, /pageName === "about\.html"/);
  assert.match(auth, /drug-consumable-about\.html/);
  assert.doesNotMatch(about, /requireRole/);
});

test("drug consumable about page documents policy sources and field boundaries", () => {
  const page = read("drug-consumable-about.html");
  assert.match(page, /data-drug-consumable-about="policy-sources"/);
  assert.match(page, /data-drug-consumable-about="system-boundaries"/);
  assert.match(page, /data-drug-consumable-about="role-boundary"/);
  assert.match(page, /data-drug-consumable-about="acceptance-boundary"/);
  assert.match(page, /https:\/\/www\.nhsa\.gov\.cn\/art\/2025\/3\/19\/art_104_16045\.html/);
  assert.match(page, /https:\/\/www\.nhsa\.gov\.cn\/art\/2024\/9\/30\/art_109_14042\.html/);
  assert.match(page, /https:\/\/www\.nmpa\.gov\.cn\/directory\/web\/nmpa\/images\/1656320881524098380\.pdf/);
  assert.match(page, /medicationPickups/);
  assert.match(page, /insuranceClaims/);
  assert.match(page, /institutionSupervisions/);
  assert.match(page, /workflow-actions/);
  assert.match(page, /npm\.cmd run drug-consumable:readiness/);
  assert.match(read("insurance.html"), /drug-consumable-about\.html/);
  assert.match(read("institution.html"), /drug-consumable-about\.html/);
  assert.match(read("workbench.html"), /drug-consumable-about\.html/);
  assert.doesNotMatch(page, /requireRole/);
});

test("static snapshot keeps completed P2 governance collections", () => {
  const data = JSON.parse(read("data/db.json"));
  assert.equal(data.creditEvaluationRules.version, "credit-rules-2026.1");
  assert.equal(Array.isArray(data.researchDatasets), true);
  assert.equal(data.researchDatasets.some((item) => item.id === "rd-hypertension-001"), true);
  assert.equal(Array.isArray(data.diseaseRegistryModels), true);
  assert.equal(data.diseaseRegistryModels.some((item) => item.id === "dm-hypertension-risk-v1"), true);
  assert.equal(Array.isArray(data.drugConsumableSupervisions), true);
  assert.equal(data.drugConsumableSupervisions.some((item) => item.id === "dcs-rational-r1" && item.boundary === "rational-medication"), true);
  assert.equal(data.drugConsumableSupervisions.some((item) => item.id === "dcs-consumable-mr1" && item.boundary === "consumable-clue"), true);
  assert.equal(Array.isArray(data.drugTraceabilityPolicySources), true);
  assert.equal(data.drugTraceabilityPolicySources.some((item) => item.id === "nhsa-2025-7" && item.documentNo === "医保发〔2025〕7号"), true);
  assert.equal(data.drugTraceabilityPolicySources.some((item) => item.id === "nmpa-2022-label" && item.documentNo === "NMPAB/T 1011-2022"), true);
  assert.equal(data.drugTraceabilityPolicySources.every((item) => /^https:\/\/(www\.)?(nhsa|nmpa)\.gov\.cn\//.test(item.url)), true);
  assert.equal(Array.isArray(data.drugTraceabilityEvidenceRequirements), true);
  assert.equal(data.drugTraceabilityEvidenceRequirements.some((item) => item.id === "trace-code-mapping" && item.policySourceIds.includes("nmpa-2019-32")), true);
  assert.equal(data.drugTraceabilityEvidenceRequirements.every((item) => Array.isArray(item.evidenceFields) && item.evidenceFields.length > 0), true);
  assert.equal(data.mobileExperienceSettings.weakNetworkMode, "cache-last-state");
  assert.equal(Array.isArray(data.accessibilityChecklist), true);
  assert.equal(data.accessibilityChecklist.some((item) => item.id === "a11y-large-font"), true);
  assert.equal(Array.isArray(data.productionDeploymentPlan), true);
  assert.equal(data.productionDeploymentPlan.some((item) => item.id === "prod-storage-adapter"), true);
  assert.equal(Array.isArray(data.countyAcceptanceLedger), true);
  assert.equal(data.countyAcceptanceLedger.some((item) => item.id === "county-accept-report-return"), true);
  assert.equal(data.countyAcceptanceLedger.some((item) => item.metricKey === "criticalAlert"), true);
  assert.equal(Array.isArray(data.platformInterfaces), true);
  assert.equal(data.platformInterfaces.filter((item) => item.priority === "P0").every((item) => item.owner && item.status && item.next), true);
  assert.equal(data.platformInterfaces.filter((item) => item.priority === "P0").every((item) => item.status === "演示对接完成"), true);
  assert.equal(data.platformInterfaces.some((item) => item.id === "if-medical" && /HIS\/EMR\/LIS\/PACS/.test(item.existing)), true);
  assert.equal(data.platformCapabilities.some((item) => item.id === "cap-data-platform" && item.status === "演示底座闭环"), true);
  assert.equal(data.platformCapabilities.some((item) => item.id === "cap-evaluation" && item.status === "测评证据已建档"), true);
  assert.equal(data.platformCapabilities.some((item) => item.id === "cap-security" && item.status === "安全证据已建档"), true);
  assert.equal(data.applicationCatalog.some((item) => item.id === "app-institution" && item.status === "演示对接完成"), true);
  assert.equal(data.securityAcceptanceLedger.every((item) => item.id && item.category && item.owner && item.status && item.next), true);
  assert.equal(data.securityAcceptanceLedger.every((item) => /建档/.test(item.status)), true);
  assert.equal(data.platformRoadmap.filter((item) => item.priority === "P2").every((item) => item.status === "已完成"), true);
});

test("static snapshot keeps acceptance evidence clean and actionable", () => {
  const raw = read("data/db.json");
  const data = JSON.parse(raw);
  assert.doesNotMatch(raw, /编码损坏，待核验/);
  assert.doesNotMatch(raw, /\?\?\?/);
  assert.doesNotMatch(raw, /�/);
  const interoperability = data.platformEvidence.find((item) => item.id === "ev-interoperability");
  assert.equal(interoperability.status, "已建档");
  assert.equal(interoperability.records.length >= 2, true);
  const security = data.platformEvidence.find((item) => item.id === "ev-security");
  assert.equal(security.status, "已建档");
  assert.equal(security.records.length >= 3, true);
  const launch = data.platformEvidence.find((item) => item.id === "ev-launch");
  assert.equal(launch.status, "演示验收建档");
  assert.equal(launch.records.length >= 3, true);
  assert.equal(interoperability.records.every((item) => item.owner && item.testRecord && item.status), true);
  assert.equal(security.records.every((item) => item.owner && item.testRecord && item.status), true);
  assert.equal(launch.records.every((item) => item.owner && item.testRecord && item.status), true);
  assert.equal(interoperability.records.some((item) => item.link === "/api/system/readiness"), true);
});

test("chronic disease policy module exposes 2025 service capacity workflow", () => {
  const data = JSON.parse(read("data/db.json"));
  const html = read("index.html");
  const app = read("app.js");
  const server = read("server.js");
  ["chronicServiceRoles", "chronicCapabilityConditions", "chronicServicePathways", "chronicComorbidityPlans", "chronicTcmServices", "chronicSelfManagement", "chronicMedicationSupport", "chronicQualityMetrics", "chronicAcceptanceLedger"].forEach((key) => {
    assert.equal(Array.isArray(data[key]), true, `${key} should be seeded`);
    assert.equal(data[key].length > 0, true, `${key} should not be empty`);
  });
  assert.equal(data.chronicAcceptanceLedger.some((item) => item.id === "chronic-accept-quality"), true);
  assert.equal(data.chronicAcceptanceLedger.some((item) => item.metricKey === "selfManagement"), true);
  ["chronic-service-roles", "chronic-capability-conditions", "chronic-service-pathways", "chronic-comorbidity-table", "chronic-tcm-services", "chronic-self-management", "chronic-medication-support", "chronic-quality-metrics"].forEach((id) => {
    assert.match(html, new RegExp(id), `${id} panel should be present`);
  });
  assert.match(html, /chronic-risk-summary/);
  assert.match(html, /chronic-risk-stratification/);
  assert.match(app, /renderChronicPolicyServices/);
  assert.match(app, /applyChronicWorkflowAction/);
  assert.match(app, /renderChronicRiskStratification/);
  assert.match(app, /buildChronicRiskStratification/);
  assert.match(app, /chronicComorbidityPlans/);
  assert.match(app, /chronicMedicationSupport/);
  assert.match(server, /chronic-comorbidity-plans/);
  assert.match(server, /\/api\/chronic\/acceptance-ledger/);
  assert.match(server, /\/api\/chronic\/risk-stratification/);
  assert.match(server, /buildChronicRiskStratification/);
  assert.match(server, /chronicMedicationSupport/);
  assert.match(server, /buildChronicServiceSummary/);
  assert.match(server, /buildCountyServiceSummary/);
  assert.match(server, /DEMO_TODAY/);
  assert.match(server, /2026-06-22/);
  assert.match(server, /changed && !shouldUseSqlite\(\)/);
  assert.match(server, /多病共管/);
  assert.match(server, /基层慢病健康管理中心/);
});

test("insurance portal exposes actionable drug consumable supervision workflow", () => {
  const html = read("insurance.html");
  const js = read("insurance.js");
  const institutionHtml = read("institution.html");
  const institutionJs = read("institution.js");
  const server = read("server.js");
  assert.match(html, /drug-consumable-panel/);
  assert.match(js, /renderDrugConsumableSupervision/);
  assert.match(js, /renderTraceabilityPolicySources/);
  assert.match(js, /renderTraceabilityEvidenceChecklist/);
  assert.match(js, /data-drug-traceability-policy-sources/);
  assert.match(js, /data-drug-traceability-evidence-checklist/);
  assert.match(js, /postDrugConsumableAction/);
  assert.match(js, /data-drug-action/);
  assert.match(institutionHtml, /institution-drug-consumable-panel/);
  assert.match(institutionJs, /loadInstitutionDrugConsumableSupervision/);
  assert.match(institutionJs, /renderInstitutionDrugConsumableSupervision/);
  assert.match(institutionJs, /renderInstitutionTraceabilityPolicySources/);
  assert.match(institutionJs, /renderInstitutionTraceabilityEvidenceChecklist/);
  assert.match(institutionJs, /data-institution-traceability-policy-sources/);
  assert.match(institutionJs, /data-institution-traceability-evidence-checklist/);
  assert.match(institutionJs, /postInstitutionDrugConsumableRemediation/);
  assert.match(institutionJs, /data-institution-drug-action/);
  assert.match(institutionJs, /\/drug-consumable-supervision\/\$\{encodeURIComponent\(id\)\}\/remediation/);
  assert.match(server, /buildDrugConsumableSupervision/);
  assert.match(server, /\/api\/drug-consumable-supervision/);
  assert.match(server, /traceabilityPolicySources/);
  assert.match(server, /buildDrugTraceabilityEvidenceChecklist/);
  assert.match(server, /traceabilityEvidenceChecklist/);
  assert.match(server, /drug-consumable-review/);
  assert.match(server, /drug-consumable-remediation/);
  assert.match(server, /drug-consumable-insurance-sync/);
});

test("deployment baseline documents scripts and environment template", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(Boolean(pkg.scripts["deploy:check"]), true);
  assert.equal(Boolean(pkg.scripts["env:check"]), true);
  assert.equal(Boolean(pkg.scripts["release:report"]), true);
  assert.equal(Boolean(pkg.scripts["release:manifest"]), true);
  assert.equal(Boolean(pkg.scripts["rollback:snapshot"]), true);
  assert.equal(Boolean(pkg.scripts["storage:inspect"]), true);
  assert.equal(Boolean(pkg.scripts["identity:contract"]), true);
  assert.equal(Boolean(pkg.scripts["audit:retention"]), true);
  assert.equal(Boolean(pkg.scripts["data-quality:report"]), true);
  assert.equal(Boolean(pkg.scripts["drug-consumable:readiness"]), true);
  assert.equal(Boolean(pkg.scripts["environment:matrix"]), true);
  assert.equal(Boolean(pkg.scripts["integration:readiness"]), true);
  assert.equal(Boolean(pkg.scripts["interface:mapping"]), true);
  assert.equal(Boolean(pkg.scripts["monitoring:readiness"]), true);
  assert.equal(Boolean(pkg.scripts["operations:readiness"]), true);
  assert.equal(Boolean(pkg.scripts["process:audit"]), true);
  assert.equal(Boolean(pkg.scripts["site:pack"]), true);
  assert.equal(Boolean(pkg.scripts["production-db:readiness"]), true);
  assert.equal(Boolean(pkg.scripts["evaluation:evidence"]), true);
  assert.match(read(".env.example"), /SESSION_SECRETS=/);
  assert.match(read(".env.example"), /INTEGRATION_GATEWAY_SECRET=/);
  assert.match(read(".env.example"), /CUTOVER_SITE_INTERFACE_SIGNOFF/);
  assert.match(read(".env.example"), /CUTOVER_DR_REHEARSAL_SIGNOFF/);
  assert.match(read(".env.example"), /OIDC_ISSUER_URL=/);
  assert.match(read(".env.example"), /AUDIT_EXPORT_PATH=/);
  assert.match(read("README.md"), /\/api\/health/);
  assert.match(read("README.md"), /deploy:check/);
  assert.match(read("README.md"), /release:report/);
  assert.match(read("README.md"), /release:manifest/);
  assert.match(read("scripts/release-report.js"), /test:coverage/);
  assert.match(read("scripts/release-report.js"), /test:e2e/);
  assert.match(read("scripts/release-report.js"), /Production cutover checklist/);
  assert.match(read("README.md"), /production-cutover-checklist\.md/);
  assert.match(read("README.md"), /storage-model-inspection\.md/);
  assert.match(read("README.md"), /identity-contract\.md/);
  assert.match(read("README.md"), /audit-retention-report\.md/);
  assert.match(read("README.md"), /data-quality-report\.md/);
  assert.match(read("README.md"), /drug-consumable-readiness-report\.md/);
  assert.match(read("README.md"), /drug-consumable-about\.html/);
  assert.match(read("README.md"), /environment-matrix-report\.md/);
  assert.match(read("README.md"), /integration-readiness-report\.md/);
  assert.match(read("README.md"), /interface-mapping-report\.md/);
  assert.match(read("README.md"), /monitoring-readiness-report\.md/);
  assert.match(read("README.md"), /operations-readiness-report\.md/);
  assert.match(read("README.md"), /process-audit-report\.md/);
  assert.match(read("README.md"), /service-acceptance-summary\.md/);
  assert.match(read("README.md"), /\/api\/service-acceptance-summary/);
  assert.match(read("README.md"), /site-readiness-pack\.md/);
  assert.match(read("README.md"), /release\/templates\/\*\/README\.md/);
  assert.match(read("README.md"), /\/api\/site-template-readmes/);
  assert.match(read("README.md"), /production-db-readiness-report\.md/);
  assert.match(read("README.md"), /evaluation-evidence-report\.md/);
  assert.match(read("README.md"), /release-artifact-manifest\.md/);
  assert.match(read("DEPLOYMENT.md"), /storage-model-inspection\.md/);
  assert.match(read("DEPLOYMENT.md"), /identity-contract\.md/);
  assert.match(read("DEPLOYMENT.md"), /audit-retention-report\.md/);
  assert.match(read("DEPLOYMENT.md"), /data-quality-report\.md/);
  assert.match(read("DEPLOYMENT.md"), /drug-consumable-readiness-report\.md/);
  assert.match(read("DEPLOYMENT.md"), /drug-consumable-about\.html/);
  assert.match(read("DEPLOYMENT.md"), /environment-matrix-report\.md/);
  assert.match(read("DEPLOYMENT.md"), /integration-readiness-report\.md/);
  assert.match(read("DEPLOYMENT.md"), /interface-mapping-report\.md/);
  assert.match(read("DEPLOYMENT.md"), /monitoring-readiness-report\.md/);
  assert.match(read("DEPLOYMENT.md"), /operations-readiness-report\.md/);
  assert.match(read("DEPLOYMENT.md"), /process-audit-report\.md/);
  assert.match(read("DEPLOYMENT.md"), /site-readiness-pack\.md/);
  assert.match(read("DEPLOYMENT.md"), /release\/templates\/\*\/README\.md/);
  assert.match(read("DEPLOYMENT.md"), /\/api\/site-template-readmes/);
  assert.match(read("DEPLOYMENT.md"), /service-acceptance-summary\.md/);
  assert.match(read("DEPLOYMENT.md"), /\/api\/service-acceptance-summary/);
  assert.match(read("DEPLOYMENT.md"), /production-db-readiness-report\.md/);
  assert.match(read("DEPLOYMENT.md"), /evaluation-evidence-report\.md/);
  assert.match(read("DEPLOYMENT.md"), /release-artifact-manifest\.md/);
  assert.match(read("scripts/deploy-check.js"), /test:coverage/);
  assert.match(read("scripts/deploy-check.js"), /test:e2e/);
  assert.match(read("scripts/deploy-check.js"), /audit/);
  assert.match(read("scripts/deploy-check.js"), /identity:contract/);
  assert.match(read("scripts/deploy-check.js"), /audit:retention/);
  assert.match(read("scripts/deploy-check.js"), /data-quality:report/);
  assert.match(read("scripts/deploy-check.js"), /drug-consumable:readiness/);
  assert.match(read("scripts/deploy-check.js"), /drug-consumable-about\.html/);
  assert.match(read("scripts/deploy-check.js"), /environment:matrix/);
  assert.match(read("scripts/deploy-check.js"), /integration:readiness/);
  assert.match(read("scripts/deploy-check.js"), /interface:mapping/);
  assert.match(read("scripts/deploy-check.js"), /monitoring:readiness/);
  assert.match(read("scripts/deploy-check.js"), /operations:readiness/);
  assert.match(read("scripts/deploy-check.js"), /process:audit/);
  assert.match(read("scripts/deploy-check.js"), /site:pack/);
  assert.match(read("scripts/deploy-check.js"), /release:manifest/);
  assert.match(read("scripts/deploy-check.js"), /production-db:readiness/);
  assert.match(read("scripts/deploy-check.js"), /evaluation:evidence/);
  assert.match(read("scripts/deploy-check.js"), /process\.platform === "win32" \? "npm\.cmd" : "npm"/);
  assert.match(read(".github/workflows/ci.yml"), /npm run deploy:check/);
  assert.match(read(".github/workflows/ci.yml"), /npm run storage:inspect/);
  assert.match(read(".github/workflows/ci.yml"), /npm run identity:contract/);
  assert.match(read(".github/workflows/ci.yml"), /npm run audit:retention/);
  assert.match(read(".github/workflows/ci.yml"), /npm run data-quality:report/);
  assert.match(read(".github/workflows/ci.yml"), /npm run drug-consumable:readiness/);
  assert.match(read(".github/workflows/ci.yml"), /npm run integration:readiness/);
  assert.match(read(".github/workflows/ci.yml"), /npm run interface:mapping/);
  assert.match(read(".github/workflows/ci.yml"), /npm run monitoring:readiness/);
  assert.match(read(".github/workflows/ci.yml"), /npm run operations:readiness/);
  assert.match(read(".github/workflows/ci.yml"), /npm run site:pack/);
  assert.match(read(".github/workflows/ci.yml"), /npm run production-db:readiness/);
  assert.match(read(".github/workflows/ci.yml"), /npm run evaluation:evidence/);
  assert.match(read(".github/workflows/ci.yml"), /npm run release:manifest/);
  assert.match(read(".github/workflows/ci.yml"), /npm run release:report/);
  assert.match(read(".github/workflows/ci.yml"), /actions\/upload-artifact@v4/);
  assert.match(read(".github/workflows/ci.yml"), /release-readiness-report/);
  assert.match(read(".github/workflows/ci.yml"), /npm audit --omit=dev/);
});

test("platform and workbench expose P2 governance and runtime panels", () => {
  const platformHtml = read("platform.html");
  const platformJs = read("platform.js");
  const workbenchHtml = read("workbench.html");
  const workbenchJs = read("workbench.js");
  assert.match(platformHtml, /research-governance/);
  assert.match(platformHtml, /mobile-accessibility-governance/);
  assert.match(platformHtml, /production-deployment-plan/);
  assert.match(platformJs, /renderResearchGovernance/);
  assert.match(platformJs, /renderMobileAccessibilityGovernance/);
  assert.match(platformJs, /renderProductionDeploymentPlan/);
  assert.match(platformJs, /evr-interoperability-contracts/);
  assert.match(platformJs, /integration-readiness-report\.md/);
  assert.match(platformJs, /audit-retention-report\.md/);
  assert.match(platformJs, /HIS\/EMR\/LIS\/PACS 契约和网关模拟接入/);
  assert.doesNotMatch(platformJs, /domain: "统一认证"[^\n]*status: "开发中"/);
  assert.doesNotMatch(platformJs, /domain: "医疗机构业务系统"[^\n]*status: "待接口"/);
  assert.match(workbenchHtml, /system-readiness/);
  assert.match(workbenchHtml, /release-evidence-gates/);
  assert.match(workbenchHtml, /drug-consumable-supervision-panel/);
  assert.match(workbenchHtml, /acceptance-ledgers/);
  assert.match(workbenchHtml, /site-readiness-pack/);
  assert.match(workbenchJs, /loadOperationalMetrics/);
  assert.match(workbenchJs, /loadSystemReadiness/);
  assert.match(workbenchJs, /loadAcceptanceLedgers/);
  assert.match(workbenchJs, /loadServiceAcceptanceSummary/);
  assert.match(workbenchJs, /data-service-open-action/);
  assert.match(workbenchJs, /loadSiteReadinessPack/);
  assert.match(workbenchJs, /loadSiteTemplateReadmes/);
  assert.match(workbenchJs, /loadReleaseReport/);
  assert.match(workbenchJs, /loadProductionCutoverChecklist/);
  assert.match(workbenchJs, /loadReleaseArtifactManifest/);
  assert.match(workbenchJs, /loadUnifiedTaskReport/);
  assert.match(workbenchJs, /loadDrugConsumableSupervision/);
  assert.match(workbenchJs, /renderDrugConsumableSupervision/);
  assert.match(workbenchJs, /renderDrugTraceabilityPolicyRow/);
  assert.match(workbenchJs, /renderDrugTraceabilityEvidenceChecklistRow/);
  assert.match(workbenchJs, /data-drug-traceability-policy-sources/);
  assert.match(workbenchJs, /data-drug-traceability-evidence-checklist/);
  assert.match(workbenchJs, /data-unified-task/);
  assert.match(workbenchJs, /renderReleaseEvidenceGates/);
  assert.match(workbenchJs, /data-quality:report/);
  assert.match(workbenchJs, /operations:readiness/);
  assert.match(workbenchJs, /process:audit/);
  assert.match(workbenchJs, /service:acceptance/);
  assert.match(workbenchJs, /site:pack/);
  assert.match(workbenchJs, /release:manifest/);
  assert.match(workbenchJs, /production:cutover/);
  assert.match(workbenchJs, /evaluation:evidence/);
  assert.match(read("server.js"), /release-artifact-manifest/);
  assert.match(workbenchJs, /\/api\/metrics/);
  assert.match(workbenchJs, /\/api\/system\/readiness/);
  assert.match(workbenchJs, /\/api\/process-audit/);
  assert.match(workbenchJs, /\/api\/service-acceptance-summary/);
  assert.match(workbenchJs, /\/api\/site-readiness-pack/);
  assert.match(workbenchJs, /\/api\/site-template-readmes/);
  assert.match(workbenchJs, /\/api\/release-report/);
  assert.match(workbenchJs, /\/api\/production-cutover-checklist/);
  assert.match(workbenchJs, /\/api\/release-artifact-manifest/);
  assert.match(workbenchJs, /\/api\/tasks/);
  assert.match(workbenchJs, /\/api\/drug-consumable-supervision/);
  assert.match(workbenchJs, /\/api\/chronic\/acceptance-ledger/);
  assert.match(workbenchJs, /\/api\/county\/acceptance-ledger/);
  assert.match(read("server.js"), /\/api\/process-audit/);
  assert.match(read("server.js"), /\/api\/service-acceptance-summary/);
  assert.match(read("server.js"), /\/api\/site-readiness-pack/);
  assert.match(read("server.js"), /SERVICE_DOMAIN_BY_COLLECTION/);
  assert.match(read("server.js"), /drugConsumableSupervisions: "drugConsumable"/);
  assert.match(read("server.js"), /priorityLevel/);
  assert.match(read("server.js"), /\/api\/site-template-readmes/);
  assert.match(read("server.js"), /\/api\/release-report/);
  assert.match(read("server.js"), /\/api\/production-cutover-checklist/);
  assert.match(read("server.js"), /\/api\/release-artifact-manifest/);
});

test("system structure documentation reflects completed local governance loops", () => {
  const systemDoc = read("docs/慢病平台系统结构图与优化建议.md");
  assert.match(systemDoc, /后续优先级边界/);
  assert.match(systemDoc, /本地已完成签名会话、接口级权限/);
  assert.match(systemDoc, /已完成 HIS\/EMR\/LIS\/PACS\/医保\/证照\/统计契约/);
  assert.match(systemDoc, /生产切换证据深化/);
});

test("citizen portal exposes P1 record details trends and source labels", () => {
  const citizenHtml = read("citizen.html");
  const citizenJs = read("citizen.js");
  const citizenCss = read("citizen.css");
  assert.match(citizenHtml, /citizen-trend-grid/);
  assert.match(citizenJs, /renderHealthTrends/);
  assert.match(citizenJs, /buildCitizenTrendSeries/);
  assert.match(citizenJs, /renderCitizenTrend/);
  assert.match(citizenJs, /record-detail/);
  assert.match(citizenJs, /renderSourceBadge/);
  assert.match(citizenJs, /classifyDataSource/);
  assert.match(citizenCss, /citizen-trend-card/);
  assert.match(citizenCss, /source-badge/);
  assert.match(citizenCss, /record-detail/);
});

test("citizen portal exposes PWA install and offline shell assets", () => {
  const citizenHtml = read("citizen.html");
  const manifest = JSON.parse(read("manifest.webmanifest"));
  const serviceWorker = read("service-worker.js");
  assert.match(citizenHtml, /rel="manifest"/);
  assert.match(citizenHtml, /serviceWorker\.register\("\.\/service-worker\.js"\)/);
  assert.equal(manifest.start_url, "./citizen.html");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.icons.some((item) => item.src === "./pwa-icon.svg"), true);
  assert.match(serviceWorker, /CACHE_NAME/);
  assert.match(serviceWorker, /citizen\.html/);
  assert.match(serviceWorker, /mobile-preview\.html/);
  assert.match(serviceWorker, /data\/db\.json/);
  assert.match(read("package.json"), /node --check service-worker\.js/);
  assert.match(read("README.md"), /manifest\.webmanifest/);
  assert.match(read("README.md"), /service-worker\.js/);
});

test("citizen portal exposes P2 imaging and attachment archive categories", () => {
  const citizenHtml = read("citizen.html");
  const citizenJs = read("citizen.js");
  assert.match(citizenHtml, /value="imaging"/);
  assert.match(citizenHtml, /value="attachments"/);
  assert.match(citizenJs, /key: "imaging"/);
  assert.match(citizenJs, /key: "attachments"/);
  assert.match(citizenJs, /PACS/);
  assert.match(citizenJs, /attachmentType/);
  assert.match(citizenJs, /renderAttachmentMeta/);
  assert.match(read("citizen.css"), /attachment-meta/);
  assert.match(citizenJs, /buildHealthTimeline\(archive, records, labs, medications, allergies, vaccines, admissions, imaging, attachments\)/);
  assert.match(read("README.md"), /影像资料和附件资料/);
  assert.match(read("docs/C端全流程审计与优化清单.md"), /PWA manifest/);
  assert.match(read("docs/C端全流程审计与优化清单.md"), /影像资料、附件资料/);
});
