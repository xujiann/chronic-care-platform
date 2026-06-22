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
  const pages = ["citizen.html", "mobile-preview.html", "institution.html", "insurance.html", "county.html", "index.html", "platform.html", "workbench.html"];
  pages.forEach((file) => assert.doesNotMatch(read(file), /href=["']#["']/, `${file} 存在空链接占位`));
});

test("static snapshot keeps completed P2 governance collections", () => {
  const data = JSON.parse(read("data/db.json"));
  assert.equal(data.creditEvaluationRules.version, "credit-rules-2026.1");
  assert.equal(Array.isArray(data.researchDatasets), true);
  assert.equal(data.researchDatasets.some((item) => item.id === "rd-hypertension-001"), true);
  assert.equal(Array.isArray(data.diseaseRegistryModels), true);
  assert.equal(data.diseaseRegistryModels.some((item) => item.id === "dm-hypertension-risk-v1"), true);
  assert.equal(data.mobileExperienceSettings.weakNetworkMode, "cache-last-state");
  assert.equal(Array.isArray(data.accessibilityChecklist), true);
  assert.equal(data.accessibilityChecklist.some((item) => item.id === "a11y-large-font"), true);
  assert.equal(Array.isArray(data.productionDeploymentPlan), true);
  assert.equal(data.productionDeploymentPlan.some((item) => item.id === "prod-storage-adapter"), true);
  assert.equal(Array.isArray(data.platformInterfaces), true);
  assert.equal(data.platformInterfaces.filter((item) => item.priority === "P0").every((item) => item.owner && item.status && item.next), true);
  assert.equal(data.platformInterfaces.filter((item) => item.priority === "P0").every((item) => item.status === "演示对接完成"), true);
  assert.equal(data.platformInterfaces.some((item) => item.id === "if-medical" && /HIS\/EMR\/LIS\/PACS/.test(item.existing)), true);
  assert.equal(data.securityAcceptanceLedger.every((item) => item.id && item.category && item.owner && item.status && item.next), true);
  assert.equal(data.platformRoadmap.filter((item) => item.priority === "P2").every((item) => item.status === "已完成"), true);
});

test("static snapshot keeps acceptance evidence clean and actionable", () => {
  const raw = read("data/db.json");
  const data = JSON.parse(raw);
  assert.doesNotMatch(raw, /编码损坏，待核验/);
  assert.doesNotMatch(raw, /\?\?\?/);
  const interoperability = data.platformEvidence.find((item) => item.id === "ev-interoperability");
  assert.equal(interoperability.status, "已建档");
  assert.equal(interoperability.records.length >= 2, true);
  assert.equal(interoperability.records.every((item) => item.owner && item.testRecord && item.status), true);
  assert.equal(interoperability.records.some((item) => item.link === "/api/system/readiness"), true);
});

test("deployment baseline documents scripts and environment template", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(Boolean(pkg.scripts["deploy:check"]), true);
  assert.equal(Boolean(pkg.scripts["env:check"]), true);
  assert.equal(Boolean(pkg.scripts["release:report"]), true);
  assert.equal(Boolean(pkg.scripts["rollback:snapshot"]), true);
  assert.equal(Boolean(pkg.scripts["storage:inspect"]), true);
  assert.equal(Boolean(pkg.scripts["identity:contract"]), true);
  assert.equal(Boolean(pkg.scripts["audit:retention"]), true);
  assert.equal(Boolean(pkg.scripts["data-quality:report"]), true);
  assert.equal(Boolean(pkg.scripts["integration:readiness"]), true);
  assert.equal(Boolean(pkg.scripts["operations:readiness"]), true);
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
  assert.match(read("scripts/release-report.js"), /test:coverage/);
  assert.match(read("scripts/release-report.js"), /test:e2e/);
  assert.match(read("scripts/release-report.js"), /Production cutover checklist/);
  assert.match(read("README.md"), /production-cutover-checklist\.md/);
  assert.match(read("README.md"), /storage-model-inspection\.md/);
  assert.match(read("README.md"), /identity-contract\.md/);
  assert.match(read("README.md"), /audit-retention-report\.md/);
  assert.match(read("README.md"), /data-quality-report\.md/);
  assert.match(read("README.md"), /integration-readiness-report\.md/);
  assert.match(read("README.md"), /operations-readiness-report\.md/);
  assert.match(read("README.md"), /evaluation-evidence-report\.md/);
  assert.match(read("DEPLOYMENT.md"), /storage-model-inspection\.md/);
  assert.match(read("DEPLOYMENT.md"), /identity-contract\.md/);
  assert.match(read("DEPLOYMENT.md"), /audit-retention-report\.md/);
  assert.match(read("DEPLOYMENT.md"), /data-quality-report\.md/);
  assert.match(read("DEPLOYMENT.md"), /integration-readiness-report\.md/);
  assert.match(read("DEPLOYMENT.md"), /operations-readiness-report\.md/);
  assert.match(read("DEPLOYMENT.md"), /evaluation-evidence-report\.md/);
  assert.match(read("scripts/deploy-check.js"), /test:coverage/);
  assert.match(read("scripts/deploy-check.js"), /test:e2e/);
  assert.match(read("scripts/deploy-check.js"), /audit/);
  assert.match(read("scripts/deploy-check.js"), /identity:contract/);
  assert.match(read("scripts/deploy-check.js"), /audit:retention/);
  assert.match(read("scripts/deploy-check.js"), /data-quality:report/);
  assert.match(read("scripts/deploy-check.js"), /integration:readiness/);
  assert.match(read("scripts/deploy-check.js"), /operations:readiness/);
  assert.match(read("scripts/deploy-check.js"), /evaluation:evidence/);
  assert.match(read("scripts/deploy-check.js"), /process\.platform === "win32" \? "npm\.cmd" : "npm"/);
  assert.match(read(".github/workflows/ci.yml"), /npm run deploy:check/);
  assert.match(read(".github/workflows/ci.yml"), /npm run storage:inspect/);
  assert.match(read(".github/workflows/ci.yml"), /npm run identity:contract/);
  assert.match(read(".github/workflows/ci.yml"), /npm run audit:retention/);
  assert.match(read(".github/workflows/ci.yml"), /npm run data-quality:report/);
  assert.match(read(".github/workflows/ci.yml"), /npm run integration:readiness/);
  assert.match(read(".github/workflows/ci.yml"), /npm run operations:readiness/);
  assert.match(read(".github/workflows/ci.yml"), /npm run evaluation:evidence/);
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
  assert.match(workbenchJs, /loadOperationalMetrics/);
  assert.match(workbenchJs, /loadSystemReadiness/);
  assert.match(workbenchJs, /renderReleaseEvidenceGates/);
  assert.match(workbenchJs, /data-quality:report/);
  assert.match(workbenchJs, /operations:readiness/);
  assert.match(workbenchJs, /evaluation:evidence/);
  assert.match(workbenchJs, /\/api\/metrics/);
  assert.match(workbenchJs, /\/api\/system\/readiness/);
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
