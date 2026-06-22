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
  assert.match(read(".env.example"), /SESSION_SECRETS=/);
  assert.match(read(".env.example"), /INTEGRATION_GATEWAY_SECRET=/);
  assert.match(read(".env.example"), /OIDC_ISSUER_URL=/);
  assert.match(read(".env.example"), /AUDIT_EXPORT_PATH=/);
  assert.match(read("README.md"), /\/api\/health/);
  assert.match(read("README.md"), /deploy:check/);
  assert.match(read("README.md"), /release:report/);
  assert.match(read("scripts/release-report.js"), /test:coverage/);
  assert.match(read("scripts/release-report.js"), /test:e2e/);
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
  assert.match(workbenchHtml, /system-readiness/);
  assert.match(workbenchJs, /loadOperationalMetrics/);
  assert.match(workbenchJs, /loadSystemReadiness/);
  assert.match(workbenchJs, /\/api\/metrics/);
  assert.match(workbenchJs, /\/api\/system\/readiness/);
});
