#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "regional-data-sharing-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "regional-data-sharing-report.md");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function hasRequiredPackageFields(item) {
  return [
    "id",
    "residentId",
    "sourceInstitution",
    "sourceOrgCode",
    "targetInstitutions",
    "targetOrgCodes",
    "sharedCollections",
    "recordRefs",
    "contractRefs",
    "consentStatus",
    "qualityStatus",
    "status"
  ].every((key) => Object.prototype.hasOwnProperty.call(item, key));
}

function buildRegionalDataSharingReport(options = {}) {
  const data = options.data ?? readJson("data/db.json");
  const pkg = options.pkg ?? readJson("package.json");
  const server = options.server ?? readText("server.js");
  const html = options.html ?? readText("regional-data-sharing.html");
  const about = options.about ?? readText("regional-data-sharing-about.html");
  const client = options.client ?? readText("regional-data-sharing.js");
  const scope = data.regionalDataSharingScope || {};
  const packages = Array.isArray(data.regionalSharingPackages) ? data.regionalSharingPackages : [];
  const snapshots = data.regionalSharingSnapshots || {};
  const reviews = Array.isArray(data.regionalSharingAccessReviews) ? data.regionalSharingAccessReviews : [];
  const contracts = new Set((data.integrationContracts || []).map((item) => item.id));
  const reused = new Set(scope.reusedCollections || []);
  const statuses = new Set(["ready", "pending_review", "blocked", "archived"]);
  const packageStatuses = packages.map((item) => item.status);
  const contractRefs = packages.flatMap((item) => item.contractRefs || []);
  const checks = [
    { id: "regional:boundary", passed: (scope.boundary || []).length >= 3 && (scope.exclusions || []).length >= 3 && (scope.roles || []).length >= 3, detail: `${(scope.boundary || []).length} boundaries, ${(scope.exclusions || []).length} exclusions` },
    { id: "regional:reuseCollections", passed: ["residents", "personalRecords", "diagnosticReports", "integrationContracts", "platformEvidence"].every((key) => reused.has(key)), detail: [...reused].join(",") },
    { id: "regional:packages", passed: packages.length >= 3 && packages.every(hasRequiredPackageFields), detail: `${packages.length} packages` },
    { id: "regional:statusNorms", passed: packageStatuses.every((status) => statuses.has(status)) && Object.keys(snapshots.statusNorms || {}).length >= 4, detail: packageStatuses.join(",") },
    { id: "regional:contractRefs", passed: contractRefs.length >= 4 && contractRefs.every((id) => contracts.has(id)), detail: [...new Set(contractRefs)].join(",") },
    { id: "regional:accessReviews", passed: reviews.length >= 1 && reviews.every((item) => item.packageId && item.residentId && item.purpose && item.decision), detail: `${reviews.length} reviews` },
    { id: "regional:apiRoutes", passed: /\/api\/regional-data-sharing/.test(server) && /createRegionalSharingAccessReview/.test(server), detail: "GET and POST regional routes present" },
    { id: "regional:frontendEntry", passed: /regional-data-sharing\.js/.test(html) && /regional-access-form/.test(html) && /authFetch/.test(client), detail: "page and client workflow present" },
    { id: "regional:frontendWorkflow", passed: /regional-sharing-loop/.test(html) && /regional-selected-package/.test(html) && /regional-access-feedback/.test(html) && /selectRegionalPackage/.test(client) && /renderRegionalLoop/.test(client), detail: "loop, selection and access feedback present" },
    { id: "regional:readinessChecklist", passed: /regional-readiness-checklist/.test(html) && /renderRegionalReadinessChecklist/.test(client) && /buildRegionalReadinessChecks/.test(client), detail: "selected package readiness checks present" },
    { id: "regional:referralHandoff", passed: /data-regional-section="referral-handoff"/.test(html) && /regional-referral-handoff/.test(html) && /renderRegionalReferralHandoff/.test(client) && /buildRegionalReferralHandoff/.test(client) && /不合并运行时/.test(client), detail: "referral handoff panel and runtime boundary present" },
    { id: "regional:aboutPolicy", passed: /regional-data-sharing-about\.html/.test(html) && /data-regional-about-section="policy-basis"/.test(about) && /医疗卫生机构信息互通共享三年攻坚/.test(about) && /医疗卫生机构网络安全管理办法/.test(about), detail: "policy explanation page linked" },
    { id: "regional:releaseScript", passed: Boolean(pkg.scripts?.["regional-data-sharing:report"]), detail: pkg.scripts?.["regional-data-sharing:report"] || "missing" }
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    scope: {
      name: scope.name || "",
      roles: (scope.roles || []).map((item) => item.role),
      exclusions: scope.exclusions || [],
      reusedCollections: scope.reusedCollections || []
    },
    summary: {
      packages: packages.length,
      ready: packages.filter((item) => item.status === "ready").length,
      pendingReview: packages.filter((item) => item.status === "pending_review").length,
      accessReviews: reviews.length,
      contractRefs: [...new Set(contractRefs)].length,
      readinessChecks: packages.length * 5
    },
    packages: packages.map((item) => ({
      id: item.id,
      residentId: item.residentId,
      sourceOrgCode: item.sourceOrgCode,
      targetOrgCodes: item.targetOrgCodes,
      status: item.status,
      consentStatus: item.consentStatus,
      qualityStatus: item.qualityStatus,
      contractRefs: item.contractRefs,
      sharedCollections: item.sharedCollections
    })),
    checks
  };
}

function renderMarkdown(report) {
  return [
    "# 区域诊疗数据共享平台验收报告",
    "",
    `- 生成时间：${report.generatedAt}`,
    `- 结果：${report.ok ? "通过" : "未通过"}`,
    `- 共享包：${report.summary.packages}`,
    `- 可共享包：${report.summary.ready}`,
    `- 调阅留痕：${report.summary.accessReviews}`,
    `- 联调检查项：${report.summary.readinessChecks}`,
    "",
    "## 检查项",
    "",
    "| 结果 | 检查项 | 详情 |",
    "|---|---|---|",
    ...report.checks.map((item) => `| ${item.passed ? "通过" : "未通过"} | ${item.id} | ${String(item.detail || "").replace(/\|/g, "/")} |`),
    "",
    "## 共享包",
    "",
    "| 共享包 | 居民 | 来源 | 目标机构 | 状态 | 契约 |",
    "|---|---|---|---|---|---|",
    ...report.packages.map((item) => `| ${item.id} | ${item.residentId} | ${item.sourceOrgCode} | ${(item.targetOrgCodes || []).join(", ")} | ${item.status} | ${(item.contractRefs || []).join(", ")} |`),
    "",
    "## 现场联调边界",
    "",
    "- 开启真实跨机构调阅前，先确认生产居民主索引和授权来源。",
    "- 确认 HIS/EMR/LIS/PACS 报文签名、幂等键、报告标识和接收医师确认截图。",
    "- 医保结算、票据清分、科研脱敏和跨部门证照不纳入本应用，除非另行签字确认。",
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
  const report = buildRegionalDataSharingReport();
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

module.exports = { buildRegionalDataSharingReport, parseArgs, renderMarkdown, writeOutput };
