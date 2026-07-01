#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "maternal-child-readiness-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "maternal-child-readiness-report.md");

const FUNCTION_DOMAINS = [
  {
    id: "commission-statistics",
    name: "出生人口统计与监管",
    role: "卫健管理端",
    entry: "index.html",
    api: ["state.birthStatistics", "renderBirthStatistics", "renderMaternalChildCare"],
    data: ["birthStatistics", "birthCertificates"],
    evidence: ["birth-stat-sources", "pendingPublicSecuritySync", "pendingMaternalChildSync", "qualityPending", "maternal-child-services", "mch-risk-list"],
    acceptance: "可查看出生证明、签发、上报、电子证照、公安共享、妇幼入册、低体重儿、质控补正和风险清单。"
  },
  {
    id: "institution-certificate",
    name: "出生医学证明办理",
    role: "医疗机构端",
    entry: "institution.html",
    api: ["/api/birth-certificates", "submitBirthCertificate"],
    data: ["birthCertificates", "birthCertificateForms"],
    evidence: ["birth-certificate-form", "birthCertificateNo", "actionButton"],
    acceptance: "可登记新生儿和父母信息，办理首次签发、换发、补发、签发、上报入册和材料核验。"
  },
  {
    id: "citizen-lifecycle",
    name: "出生人口健康管理",
    role: "个人用户端",
    entry: "citizen.html",
    api: ["getBirthCertificatesForResident", "renderBirthHealth", "renderMaternalChildContinuity"],
    data: ["birthCertificates", "personalRecords"],
    evidence: ["birth-health-management", "maternal-child-continuity", "lifecycle-summary", "临终关怀与授权"],
    acceptance: "居民可查看家庭成员出生证明、妇幼入册、新生儿访视、筛查、接种、低体重儿专案、儿童保健、青少年健康、成人慢病、老年照护、临终授权和死亡证明接续。"
  },
  {
    id: "sharing-license",
    name: "证照共享与入册协同",
    role: "医疗机构端 / 卫健管理端",
    entry: "institution.html, index.html",
    api: ["/api/birth-certificates"],
    data: ["birthCertificates", "securityEvents"],
    evidence: ["electronicLicenseStatus", "publicSecuritySync", "maternalChildSync"],
    acceptance: "出生证签发后可跟踪电子证照、公安出生登记共享、妇幼健康入册和审计事件。"
  },
  {
    id: "policy-release",
    name: "政策说明与发布证据",
    role: "发布与审计",
    entry: "maternal-child-about.html",
    api: ["maternal-child:readiness", "policy:coverage", "release:manifest"],
    data: ["docs/maternal-child-policy.md", "docs/妇幼健康全模块说明.md", "docs/妇幼健康主要功能报告.md"],
    evidence: ['data-maternal-about="policy-basis"', 'data-about-flow="maternal-child-policy"', "flowchart TD"],
    acceptance: "固化政策依据、流程图、三端边界、上线依赖、统一模板规则和发布产物。"
  }
];

const HANDOFF_ACTIONS = [
  {
    id: "role-scope",
    name: "三端功能隔离",
    owner: "平台管理员",
    evidence: ["canAccessResident", "role:commission", "role:institution", "role:citizen"],
    acceptance: "登录后只展示本账号可监管、可办理、可查看的妇幼功能。"
  },
  {
    id: "certificate-policy",
    name: "出生医学证明政策字段",
    owner: "医疗机构端 / 卫健管理端",
    evidence: ["certificateVersion", "issueType", "materials", "qualityCheck"],
    acceptance: "证件版本、签发类型、材料核验、质控补正和归档状态可追溯。"
  },
  {
    id: "lifecycle-continuity",
    name: "居民全生命周期接续",
    owner: "个人用户端",
    evidence: ["birthCertificates", "personalRecords", "deathCertificates", "lifecycle-summary"],
    acceptance: "出生证明自动接续到新生儿访视、筛查、接种、儿童保健、青少年健康、成人慢病、老年照护、临终授权、死亡证明和个人健康档案。"
  },
  {
    id: "release-evidence",
    name: "发布证据闭环",
    owner: "发布与审计",
    evidence: ["maternal-child:readiness", "release:manifest", "release:report"],
    acceptance: "About、政策说明、主功能报告、测试和发布产物可互相追踪。"
  }
];

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function exists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

function hasAll(source, needles) {
  return needles.every((needle) => source.includes(needle));
}

function check(id, passed, detail, category = "maternal-child") {
  return { id, category, passed: Boolean(passed), detail };
}

function hasPolicyCertificateFields(item) {
  return Boolean(
    item.certificateVersion &&
      item.issueType &&
      Array.isArray(item.materials) &&
      item.materials.length &&
      item.qualityCheck &&
      item.healthManagementStatus &&
      item.nextService
  );
}

function hasWorkflowRules(birthStatistics, tokens) {
  const rules = Array.isArray(birthStatistics.workflowRules) ? birthStatistics.workflowRules : [];
  const source = rules.map((item) => `${item.rule || ""} ${item.deadline || ""} ${item.owner || ""} ${item.status || ""}`).join("\n");
  return tokens.every((token) => source.includes(token));
}

function expectedRiskMetrics(birthCertificates) {
  const records = Array.isArray(birthCertificates) ? birthCertificates : [];
  return {
    pendingPublicSecuritySync: records.filter((item) => !String(item.publicSecuritySync || "").includes("已共享")).length,
    pendingMaternalChildSync: records.filter((item) => !String(item.maternalChildSync || "").includes("已入册")).length,
    qualityPending: records.filter((item) => ["待质控", "待复核", "待补正"].includes(item.qualityCheck)).length
  };
}

function hasRiskMetrics(birthStatistics, birthCertificates) {
  const metrics = birthStatistics && typeof birthStatistics.metrics === "object" ? birthStatistics.metrics : {};
  const expected = expectedRiskMetrics(birthCertificates);
  return Object.entries(expected).every(([key, value]) => Number(metrics[key]) === value);
}

function hasInstitutionRiskMetricCards(source) {
  return hasAll(source, ["pendingPublicSecuritySync", "pendingMaternalChildSync", "qualityPending", "公安待共享", "妇幼待入册", "质控补正"]);
}

function hasCommissionRiskMetricCards(source) {
  return hasAll(source, ["pendingPublicSecuritySync", "pendingMaternalChildSync", "qualityPending", "公安待共享", "妇幼待入册", "质控补正", "metricValue"]);
}

function parseArgs(argv = process.argv.slice(2)) {
  const flags = {};
  argv.forEach((flag) => {
    if (!flag.startsWith("--")) return;
    const [key, ...rest] = flag.slice(2).split("=");
    flags[key] = rest.length ? rest.join("=") : true;
  });
  return {
    output: flags.output || DEFAULT_OUTPUT,
    markdown: flags.markdown || DEFAULT_MARKDOWN
  };
}

function defaultSources() {
  return {
    about: read("maternal-child-about.html"),
    moduleDoc: read("docs/妇幼健康全模块说明.md"),
    policyDoc: read("docs/maternal-child-policy.md"),
    functionReport: exists("docs/妇幼健康主要功能报告.md") ? read("docs/妇幼健康主要功能报告.md") : "",
    institution: `${read("institution.html")}\n${read("institution.js")}`,
    citizen: `${read("citizen.html")}\n${read("citizen.js")}`,
    commission: `${read("index.html")}\n${read("app.js")}`,
    server: read("server.js"),
    packageSource: read("package.json")
  };
}

function buildMaternalChildReadinessReport(options = {}) {
  const data = options.data || readJson("data/db.json");
  const sources = options.sources || defaultSources();
  const birthCertificates = Array.isArray(data.birthCertificates) ? data.birthCertificates : [];
  const birthForms = Array.isArray(data.birthCertificateForms) ? data.birthCertificateForms : [];
  const birthStatistics = data.birthStatistics && typeof data.birthStatistics === "object" ? data.birthStatistics : {};
  const riskMetrics = expectedRiskMetrics(birthCertificates);
  const dataKeys = Object.keys(data);
  const checks = [
    check("docs:policy", hasAll(sources.policyDoc, ["卫妇社发〔2009〕96 号", "国卫办妇幼发〔2023〕4 号", "flowchart TD"]) && hasAll(sources.moduleDoc, ["birthCertificates", "birthStatistics", "flowchart TD"]), "policy and module docs include policy numbers, data objects, and flow diagrams", "docs"),
    check("docs:function-report", hasAll(sources.functionReport, ["## 主要功能矩阵", "## 三端功能边界", "## 优化后交接要点", "## 发布证据"]), "main function report is present, structured, and includes handoff points", "docs"),
    check("about:page", hasAll(sources.about, ['data-maternal-about="policy-basis"', 'data-about-flow="maternal-child-policy"', "maternal-child-policy.md"]), "dedicated About page covers policy, flow, and policy document link", "about"),
    check("data:objects", ["birthCertificates", "birthCertificateForms", "birthStatistics", "residents", "personalRecords"].every((key) => dataKeys.includes(key)), "required data objects are seeded", "data"),
    check("data:birth-certificates", birthCertificates.length >= 3 && birthCertificates.every((item) => item.id && item.certificateNo && item.maternalResidentId && item.newbornName), `${birthCertificates.length} certificate records`, "data"),
    check("data:certificate-policy-fields", birthCertificates.length >= 3 && birthCertificates.every(hasPolicyCertificateFields) && hasWorkflowRules(birthStatistics, ["首次签发", "换发/补发", "空白证件", "第七版证件"]), "certificate records and statistics cover version, issue type, materials, quality, archive, blank-certificate, and seventh-version rules", "data"),
    check("data:workflow-states", birthCertificates.some((item) => item.status) && birthCertificates.some((item) => item.maternalChildSync) && birthCertificates.some((item) => item.publicSecuritySync), "certificate status, maternal-child sync, and public-security sync are modeled", "data"),
    check("data:forms-statistics", birthForms.length >= 3 && Boolean(birthStatistics.title && birthStatistics.metrics), `${birthForms.length} forms; statistics ${birthStatistics.title || "missing"}`, "data"),
    check("data:risk-metrics", hasRiskMetrics(birthStatistics, birthCertificates), "statistics expose accurate pending public-security, maternal-child sync, and quality risk counts", "data"),
    check("api:server", hasAll(sources.server, ["/api/birth-certificates", "statistics: data.birthStatistics", "canAccessResident", "appendSecurityEvent"]), "server exposes scoped birth certificate API and audit events", "api"),
    check("functions:domains", FUNCTION_DOMAINS.length >= 5 && FUNCTION_DOMAINS.every((item) => item.acceptance && item.evidence.length), `${FUNCTION_DOMAINS.length} function domains`, "function"),
    check("handoff:actions", HANDOFF_ACTIONS.length >= 4 && HANDOFF_ACTIONS.every((item) => item.acceptance && item.evidence.length), `${HANDOFF_ACTIONS.length} handoff actions`, "function"),
    check("role:commission", hasAll(sources.commission, ["renderBirthStatistics", "renderMaternalChildCare", "mch-risk-list"]), "commission portal renders statistics, maternal-child services, and risks", "role"),
    check("role:commission-risk-metrics", hasCommissionRiskMetricCards(sources.commission), "commission portal consumes public-security, maternal-child sync, and quality risk metrics", "role"),
    check("role:institution", hasAll(sources.institution, ["birth-certificate-form", "birthCertificateNo", "submitBirthCertificate", "actionButton"]), "institution portal registers and advances certificate workflow", "role"),
    check("role:institution-risk-metrics", hasInstitutionRiskMetricCards(sources.institution), "institution portal renders public-security, maternal-child sync, and quality risk metric cards", "role"),
    check("role:citizen", hasAll(sources.citizen, ["renderBirthHealth", "renderMaternalChildContinuity", "getBirthCertificatesForResident", "lifecycle-summary"]), "citizen portal exposes birth and maternal-child continuity tasks", "role"),
    check("role:citizen-lifecycle-8", hasAll(sources.citizen, ["儿童保健", "青少年健康", "成人健康", "慢病与康复", "老年与照护", "临终关怀与授权", "死亡与身后事项", "项需下发"]) && sources.citizen.includes("stages.length"), "citizen lifecycle timeline covers eight life stages and dispatch summary", "role"),
    check("role:isolation", hasAll(sources.policyDoc, ["不展示卫健监管", "机构办理"]) && sources.server.includes("canAccessResident") && !sources.citizen.includes("birth-certificate-form"), "citizen role excludes institution certificate form while server keeps resident-scoped access", "role"),
    check("release:script", hasAll(sources.packageSource, ["maternal-child:readiness", "scripts/maternal-child-readiness.js"]), "release script is available in package scripts", "release")
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    module: "maternal-child",
    summary: {
      checks: checks.length,
      passed: checks.filter((item) => item.passed).length,
      functionDomains: FUNCTION_DOMAINS.length,
      certificates: birthCertificates.length,
      forms: birthForms.length,
      riskMetrics,
      statisticsTitle: birthStatistics.title || ""
    },
    functionDomains: FUNCTION_DOMAINS,
    handoffActions: HANDOFF_ACTIONS,
    artifacts: {
      about: "maternal-child-about.html",
      moduleDoc: "docs/妇幼健康全模块说明.md",
      policyDoc: "docs/maternal-child-policy.md",
      functionReport: "docs/妇幼健康主要功能报告.md",
      api: ["/api/birth-certificates", "statistics in /api/birth-certificates"],
      data: ["birthCertificates", "birthCertificateForms", "birthStatistics", "residents", "personalRecords"]
    },
    checks
  };
}

function renderMarkdown(report) {
  const functionRows = report.functionDomains.map((item) => `| ${item.id} | ${item.name} | ${item.role} | ${item.entry} | ${item.data.join("<br>")} | ${item.evidence.join("<br>")} | ${String(item.acceptance || "").replace(/\|/g, "/")} |`);
  const handoffRows = (report.handoffActions || []).map((item) => `| ${item.id} | ${item.name} | ${item.owner} | ${item.evidence.join("<br>")} | ${String(item.acceptance || "").replace(/\|/g, "/")} |`);
  const checkRows = report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.category} | ${item.id} | ${String(item.detail || "").replace(/\|/g, "/")} |`);
  return [
    "# Maternal-child main function report",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Function domains: ${report.summary.functionDomains}`,
    `- Certificates: ${report.summary.certificates}`,
    `- Forms: ${report.summary.forms}`,
    `- Statistics: ${report.summary.statisticsTitle}`,
    `- Risk metrics: public-security pending ${report.summary.riskMetrics.pendingPublicSecuritySync}, maternal-child enrollment pending ${report.summary.riskMetrics.pendingMaternalChildSync}, quality correction pending ${report.summary.riskMetrics.qualityPending}`,
    "",
    "## Main Functions",
    "",
    "| Function | Name | Role | Entry | Data | Evidence | Acceptance |",
    "|---|---|---|---|---|---|---|",
    ...functionRows,
    "",
    "## Handoff Actions",
    "",
    "| Action | Name | Owner | Evidence | Acceptance |",
    "|---|---|---|---|---|",
    ...handoffRows,
    "",
    "## Artifacts",
    "",
    `- About: ${report.artifacts.about}`,
    `- Module document: ${report.artifacts.moduleDoc}`,
    `- Policy document: ${report.artifacts.policyDoc}`,
    `- Main function report: ${report.artifacts.functionReport}`,
    `- API: ${report.artifacts.api.join(", ")}`,
    `- Data: ${report.artifacts.data.join(", ")}`,
    "",
    "## Checks",
    "",
    "| Result | Category | Check | Detail |",
    "|---|---|---|---|",
    ...checkRows,
    ""
  ].join("\n");
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
  const report = buildMaternalChildReadinessReport();
  writeOutput(report, flags);
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
  FUNCTION_DOMAINS,
  HANDOFF_ACTIONS,
  buildMaternalChildReadinessReport,
  parseArgs,
  renderMarkdown,
  writeOutput
};
