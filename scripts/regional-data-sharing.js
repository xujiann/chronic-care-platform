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

function buildRegionalReportHandoff(packageItem, data, reviews) {
  const collections = new Set(packageItem.sharedCollections || []);
  const contractsById = new Map((data.integrationContracts || []).map((item) => [item.id, item]));
  const contracts = (packageItem.contractRefs || []).map((id) => contractsById.get(id)).filter(Boolean);
  const diagnosticReports = data.diagnosticReports || [];
  const personalRecords = data.personalRecords || [];
  const recognitionRecords = data.countyMutualRecognitionRecords || [];
  const recordRefs = packageItem.recordRefs || [];
  const evidenceCounts = {
    diagnosticReports: diagnosticReports.filter((item) => item.residentId === packageItem.residentId || recordRefs.includes(item.id)).length,
    personalRecords: personalRecords.filter((item) => item.residentId === packageItem.residentId && (recordRefs.includes(item.id) || collections.has("personalRecords"))).length,
    mutualRecognitionRecords: recognitionRecords.filter((item) => item.residentId === packageItem.residentId || recordRefs.includes(item.id)).length,
    contracts: contracts.length
  };
  const targetCount = (packageItem.targetOrgCodes || packageItem.targetInstitutions || []).length;
  const relatedReviews = reviews.filter((item) => item.packageId === packageItem.id);
  const evidence = [
    {
      id: "clinical-records",
      label: "诊疗资料",
      ready: collections.has("personalRecords") && collections.has("diagnosticReports") && evidenceCounts.personalRecords > 0 && evidenceCounts.diagnosticReports > 0,
      detail: `档案 ${evidenceCounts.personalRecords} 条，报告 ${evidenceCounts.diagnosticReports} 条`
    },
    {
      id: "mutual-recognition",
      label: "互认依据",
      ready: collections.has("countyMutualRecognitionRecords") && evidenceCounts.mutualRecognitionRecords > 0,
      detail: `互认记录 ${evidenceCounts.mutualRecognitionRecords} 条`
    },
    {
      id: "integration-contracts",
      label: "接口契约",
      ready: (packageItem.contractRefs || []).length > 0 && contracts.every((item) => item.status === "ready"),
      detail: contracts.map((item) => item.domain || item.id).join("、") || "未绑定契约"
    },
    {
      id: "consent-quality",
      label: "授权与质控",
      ready: packageItem.consentStatus === "active" && packageItem.qualityStatus === "passed",
      detail: `${packageItem.consentStatus || "unknown"} / ${packageItem.qualityStatus || "unknown"}`
    },
    {
      id: "access-audit",
      label: "调阅审计",
      ready: relatedReviews.length > 0 || Boolean(packageItem.lastAccessReviewId || packageItem.lastSharedAt),
      detail: relatedReviews.length
        ? `已有 ${relatedReviews.length} 条调阅留痕`
        : packageItem.lastAccessReviewId || packageItem.lastSharedAt
          ? `已有共享或留痕记录 ${packageItem.lastAccessReviewId || packageItem.lastSharedAt}`
          : "接诊前需登记调阅目的"
    },
    {
      id: "recipient-scope",
      label: "接收范围",
      ready: targetCount > 0,
      detail: `目标机构 ${targetCount} 个`
    }
  ];
  const readyCount = evidence.filter((item) => item.ready).length;
  return {
    ready: readyCount === evidence.length,
    readyCount,
    total: evidence.length,
    evidence
  };
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
  const handoffByPackage = new Map(packages.map((item) => [item.id, buildRegionalReportHandoff(item, data, reviews)]));
  const handoffReady = [...handoffByPackage.values()].filter((item) => item.ready).length;
  const checks = [
    { id: "regional:boundary", passed: (scope.boundary || []).length >= 3 && (scope.exclusions || []).length >= 3 && (scope.roles || []).length >= 3, detail: `${(scope.boundary || []).length} boundaries, ${(scope.exclusions || []).length} exclusions` },
    { id: "regional:reuseCollections", passed: ["residents", "personalRecords", "diagnosticReports", "integrationContracts", "platformEvidence"].every((key) => reused.has(key)), detail: [...reused].join(",") },
    { id: "regional:packages", passed: packages.length >= 3 && packages.every(hasRequiredPackageFields), detail: `${packages.length} packages` },
    { id: "regional:statusNorms", passed: packageStatuses.every((status) => statuses.has(status)) && Object.keys(snapshots.statusNorms || {}).length >= 4, detail: packageStatuses.join(",") },
    { id: "regional:contractRefs", passed: contractRefs.length >= 4 && contractRefs.every((id) => contracts.has(id)), detail: [...new Set(contractRefs)].join(",") },
    { id: "regional:accessReviews", passed: reviews.length >= 1 && reviews.every((item) => item.packageId && item.residentId && item.purpose && item.decision), detail: `${reviews.length} reviews` },
    { id: "regional:apiRoutes", passed: /\/api\/regional-data-sharing/.test(server) && /createRegionalSharingAccessReview/.test(server), detail: "GET and POST regional routes present" },
    { id: "regional:apiHandoff", passed: /buildRegionalReferralHandoffEvidence/.test(server) && /referralHandoffReady/.test(server) && /referralHandoff/.test(client), detail: "API returns referral handoff evidence per package" },
    { id: "regional:handoffEvidence", passed: handoffReady >= 1 && packages.every((item) => handoffByPackage.get(item.id)?.total === 6), detail: `${handoffReady}/${packages.length} packages ready for referral handoff` },
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
      readinessChecks: packages.length * 5,
      referralHandoffReady: handoffReady,
      referralHandoffChecks: packages.length * 6
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
      sharedCollections: item.sharedCollections,
      referralHandoff: handoffByPackage.get(item.id)
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
    `- 转诊会诊可交接包：${report.summary.referralHandoffReady}/${report.summary.packages}`,
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
    "## 转诊会诊交接证据",
    "",
    "| 共享包 | 交接状态 | 已具备 | 待补齐 |",
    "|---|---|---|---|",
    ...report.packages.map((item) => {
      const handoff = item.referralHandoff || { ready: false, readyCount: 0, total: 0, evidence: [] };
      const ready = (handoff.evidence || []).filter((evidence) => evidence.ready).map((evidence) => evidence.label).join("、") || "无";
      const pending = (handoff.evidence || []).filter((evidence) => !evidence.ready).map((evidence) => evidence.label).join("、") || "无";
      return `| ${item.id} | ${handoff.ready ? "可交接" : "需补证"} (${handoff.readyCount}/${handoff.total}) | ${ready} | ${pending} |`;
    }),
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
