#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const SIBLING_REFERRAL_ROOT = path.resolve(ROOT, "..", "02-referral-teleconsultation");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "regional-referral-overlap-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "regional-referral-overlap-report.md");

function readJson(root, relativePath, fallback = null) {
  const file = path.join(root, relativePath);
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readText(root, relativePath, fallback = "") {
  const file = path.join(root, relativePath);
  if (!fs.existsSync(file)) return fallback;
  return fs.readFileSync(file, "utf8");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function collectReferralSignals(data = {}, root = ROOT) {
  const referralSystem = data.referralSystem || {};
  const referralTeleconsultations = Array.isArray(data.referralTeleconsultations) ? data.referralTeleconsultations : [];
  const server = readText(root, "server.js");
  const packageJson = readJson(root, "package.json", {});
  return {
    root,
    present: Boolean(referralSystem.referrals || referralTeleconsultations.length || /referralTeleconsultations|referral-teleconsultations/.test(server)),
    hasTeleconsultationModel: referralTeleconsultations.length > 0 || /referralTeleconsultations/.test(server),
    hasSignedCallbacks: /feedback-callback/.test(server) && /schedule-callback/.test(server) && /report-callback/.test(server),
    hasSlaEscalation: /referral-teleconsultations\/escalations\/run/.test(server) || /SLA/.test(readText(root, "county.html") + readText(root, "county.js")),
    hasReadinessScript: Boolean(packageJson.scripts?.["referral:readiness"] || fs.existsSync(path.join(root, "scripts", "referral-teleconsultation-readiness.js"))),
    referrals: Array.isArray(referralSystem.referrals) ? referralSystem.referrals : [],
    collaborationOrders: Array.isArray(data.countyCollaborationOrders) ? data.countyCollaborationOrders : [],
    teleconsultations: referralTeleconsultations
  };
}

function buildRegionalReferralOverlapReport(options = {}) {
  const data = options.data ?? readJson(ROOT, "data/db.json", {});
  const siblingData = options.siblingData ?? readJson(SIBLING_REFERRAL_ROOT, "data/db.json", null);
  const packages = Array.isArray(data.regionalSharingPackages) ? data.regionalSharingPackages : [];
  const reviews = Array.isArray(data.regionalSharingAccessReviews) ? data.regionalSharingAccessReviews : [];
  const regionalAbout = options.regionalAbout ?? readText(ROOT, "regional-data-sharing-about.html");
  const currentReferral = collectReferralSignals(data, ROOT);
  const siblingReferral = siblingData ? collectReferralSignals(siblingData, SIBLING_REFERRAL_ROOT) : null;
  const referral = siblingReferral?.present ? siblingReferral : currentReferral;
  const referralRows = [
    ...(referral.referrals || []),
    ...(referral.collaborationOrders || []),
    ...(referral.teleconsultations || [])
  ];
  const regionalResidentIds = unique(packages.map((item) => item.residentId));
  const referralResidentIds = unique(referralRows.map((item) => item.residentId));
  const sharedResidentIds = regionalResidentIds.filter((id) => referralResidentIds.includes(id));
  const regionalOrgCodes = unique(packages.flatMap((item) => [item.sourceOrgCode, ...(item.targetOrgCodes || [])]));
  const referralOrgCodes = unique(referralRows.flatMap((item) => [item.sourceOrgCode, item.targetOrgCode, item.fromOrgCode, item.toOrgCode, item.orgCode, item.consortiumOrgCode]));
  const sharedOrgCodes = regionalOrgCodes.filter((id) => referralOrgCodes.includes(id));
  const sharedCollections = ["residents", "personalRecords", "diagnosticReports", "countyMutualRecognitionRecords", "integrationContracts", "dataAccessLogs", "securityEvents"];
  const boundaries = [
    {
      domain: "区域诊疗数据共享",
      owner: "数据共享与合规审计",
      keeps: ["共享包编目", "居民授权", "质控状态", "接口契约", "调阅审计"],
      shouldNotAbsorb: ["转诊单排期", "号源床位", "接诊反馈", "SLA 督办", "绩效结算"]
    },
    {
      domain: "医联体转诊与远程会诊",
      owner: "转诊中心与医共体办公室",
      keeps: ["转诊申请", "接诊/下转", "远程会诊", "报告回传", "SLA 与绩效"],
      shouldNotAbsorb: ["居民授权主索引", "共享包质控裁剪", "跨机构调阅审计总账"]
    }
  ];
  const mergeActions = [
    "共享 residents、personalRecords、diagnosticReports、countyMutualRecognitionRecords、integrationContracts、dataAccessLogs 和 securityEvents 作为交接证据。",
    "转诊发起或接诊前通过区域共享包调阅必要诊疗资料；调阅结果只回写审计，不替代转诊单状态。",
    "转诊回传报告进入个人健康档案和诊断报告后，可被区域共享包再次编目和互认。",
    "现场验收合并为同一份交接报告：区域共享证明数据可调阅，转诊会诊证明业务可流转。"
  ];
  const nonMergeReasons = [
    "区域共享 API 当前围绕 /api/regional-data-sharing 和调阅审计，医联体转诊专项围绕 /api/referral-teleconsultations、回调、SLA 和绩效。",
    "区域共享的授权/质控失败应阻断调阅，但不应直接关闭或改写转诊单。",
    "转诊 SLA、号源床位、会诊报告回传涉及医疗服务履约，不应由数据共享平台承担主责。",
    "两者角色边界不同：区域共享面向管理端和机构端，转诊会诊还涉及县域医共体、医保绩效和居民通知。"
  ];
  const checks = [
    { id: "overlap:sharedCollections", passed: sharedCollections.length >= 6, detail: sharedCollections.join(",") },
    { id: "overlap:regionalPackages", passed: packages.length >= 3, detail: `${packages.length} regional sharing packages` },
    { id: "overlap:regionalAudit", passed: reviews.length >= 1, detail: `${reviews.length} regional access reviews` },
    { id: "overlap:referralSignals", passed: referral.present, detail: referral.present ? `source=${referral.root}` : "referral signals missing" },
    { id: "overlap:mergeBoundary", passed: /data-regional-about-section="merge-boundary"/.test(regionalAbout), detail: "regional about page documents merge boundary" }
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    decision: "部分合并：合并交接证据、报告和现场验收边界；不合并运行时主模型和 API。",
    mergeAllowed: true,
    runtimeMergeAllowed: false,
    sources: {
      regionalRoot: ROOT,
      referralRoot: referral.root,
      siblingReferralDetected: Boolean(siblingReferral?.present)
    },
    summary: {
      regionalPackages: packages.length,
      regionalAccessReviews: reviews.length,
      referralRows: referralRows.length,
      referralTeleconsultations: referral.teleconsultations.length,
      sharedResidents: sharedResidentIds.length,
      sharedOrgCodes: sharedOrgCodes.length,
      sharedCollections: sharedCollections.length
    },
    overlap: {
      sharedResidentIds,
      sharedOrgCodes,
      sharedCollections,
      referralCapabilities: {
        hasTeleconsultationModel: referral.hasTeleconsultationModel,
        hasSignedCallbacks: referral.hasSignedCallbacks,
        hasSlaEscalation: referral.hasSlaEscalation,
        hasReadinessScript: referral.hasReadinessScript
      }
    },
    boundaries,
    mergeActions,
    nonMergeReasons,
    checks
  };
}

function renderMarkdown(report) {
  return [
    "# 区域诊疗数据共享与医联体转诊重合度检查报告",
    "",
    `- 生成时间：${report.generatedAt}`,
    `- 结论：${report.decision}`,
    `- 区域共享包：${report.summary.regionalPackages}`,
    `- 区域调阅留痕：${report.summary.regionalAccessReviews}`,
    `- 转诊/会诊相关记录：${report.summary.referralRows}`,
    `- 共享居民：${report.summary.sharedResidents}`,
    `- 共享机构编码：${report.summary.sharedOrgCodes}`,
    "",
    "## 检查项",
    "",
    "| 结果 | 检查项 | 详情 |",
    "|---|---|---|",
    ...report.checks.map((item) => `| ${item.passed ? "通过" : "未通过"} | ${item.id} | ${String(item.detail || "").replace(/\|/g, "/")} |`),
    "",
    "## 可合并部分",
    "",
    ...report.mergeActions.map((item) => `- ${item}`),
    "",
    "## 不直接合并原因",
    "",
    ...report.nonMergeReasons.map((item) => `- ${item}`),
    "",
    "## 职责边界",
    "",
    "| 域 | 责任方 | 保留能力 | 不吸收能力 |",
    "|---|---|---|---|",
    ...report.boundaries.map((item) => `| ${item.domain} | ${item.owner} | ${item.keeps.join("、")} | ${item.shouldNotAbsorb.join("、")} |`),
    "",
    "## 合并建议",
    "",
    "- 保留两个运行时入口：区域共享用于数据调阅合规，医联体转诊用于业务流转履约。",
    "- 在现场验收、发布报告、联调材料中合并呈现交接链路。",
    "- 后续如要深度集成，应新增显式关联字段，例如 referralId、teleconsultationId、regionalPackageId，而不是复用单一主键。",
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
  fs.writeFileSync(markdown, renderMarkdown(report), "utf8");
}

function runCli() {
  const flags = parseArgs();
  const report = buildRegionalReferralOverlapReport();
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

module.exports = { buildRegionalReferralOverlapReport, parseArgs, renderMarkdown, writeOutput };
