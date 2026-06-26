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
    evidence: ["birth-stat-sources", "maternal-child-services", "mch-risk-list"],
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
    evidence: ["birth-health-management", "maternal-child-continuity", "lifecycle-summary"],
    acceptance: "居民可查看家庭成员出生证明、妇幼入册、新生儿访视、筛查、接种、低体重儿专案和儿童保健接续。"
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
  const dataKeys = Object.keys(data);
  const checks = [
    check("docs:policy", hasAll(sources.policyDoc, ["卫妇社发〔2009〕96 号", "国卫办妇幼发〔2023〕4 号", "flowchart TD"]) && hasAll(sources.moduleDoc, ["birthCertificates", "birthStatistics", "flowchart TD"]), "policy and module docs include policy numbers, data objects, and flow diagrams", "docs"),
    check("docs:function-report", hasAll(sources.functionReport, ["## 主要功能矩阵", "## 三端功能边界", "## 发布证据"]), "main function report is present and structured", "docs"),
    check("about:page", hasAll(sources.about, ['data-maternal-about="policy-basis"', 'data-about-flow="maternal-child-policy"', "maternal-child-policy.md"]), "dedicated About page covers policy, flow, and policy document link", "about"),
    check("data:objects", ["birthCertificates", "birthCertificateForms", "birthStatistics", "residents", "personalRecords"].every((key) => dataKeys.includes(key)), "required data objects are seeded", "data"),
    check("data:birth-certificates", birthCertificates.length >= 3 && birthCertificates.every((item) => item.id && item.certificateNo && item.maternalResidentId && item.newbornName), `${birthCertificates.length} certificate records`, "data"),
    check("data:workflow-states", birthCertificates.some((item) => item.status) && birthCertificates.some((item) => item.maternalChildSync) && birthCertificates.some((item) => item.publicSecuritySync), "certificate status, maternal-child sync, and public-security sync are modeled", "data"),
    check("data:forms-statistics", birthForms.length >= 3 && Boolean(birthStatistics.title && birthStatistics.metrics), `${birthForms.length} forms; statistics ${birthStatistics.title || "missing"}`, "data"),
    check("api:server", hasAll(sources.server, ["/api/birth-certificates", "statistics: data.birthStatistics", "canAccessResident", "appendSecurityEvent"]), "server exposes scoped birth certificate API and audit events", "api"),
    check("functions:domains", FUNCTION_DOMAINS.length >= 5 && FUNCTION_DOMAINS.every((item) => item.acceptance && item.evidence.length), `${FUNCTION_DOMAINS.length} function domains`, "function"),
    check("role:commission", hasAll(sources.commission, ["renderBirthStatistics", "renderMaternalChildCare", "mch-risk-list"]), "commission portal renders statistics, maternal-child services, and risks", "role"),
    check("role:institution", hasAll(sources.institution, ["birth-certificate-form", "birthCertificateNo", "submitBirthCertificate", "actionButton"]), "institution portal registers and advances certificate workflow", "role"),
    check("role:citizen", hasAll(sources.citizen, ["renderBirthHealth", "renderMaternalChildContinuity", "getBirthCertificatesForResident", "lifecycle-summary"]), "citizen portal exposes birth and maternal-child continuity tasks", "role"),
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
      statisticsTitle: birthStatistics.title || ""
    },
    functionDomains: FUNCTION_DOMAINS,
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
    "",
    "## Main Functions",
    "",
    "| Function | Name | Role | Entry | Data | Evidence | Acceptance |",
    "|---|---|---|---|---|---|---|",
    ...functionRows,
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
  buildMaternalChildReadinessReport,
  parseArgs,
  renderMarkdown,
  writeOutput
};
