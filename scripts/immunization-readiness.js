#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const {
  DOSES,
  GENERAL_PRINCIPLES,
  HEALTH_PROFILES,
  LAUNCH_REQUIREMENTS,
  POLICY,
  SPECIAL_HEALTH_RULES,
  buildPlan,
  buildPlansFromCertificates
} = require("../immunization-schedule");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "immunization-readiness-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "immunization-readiness-report.md");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function check(id, passed, detail, category = "immunization") {
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

function buildImmunizationReadinessReport(options = {}) {
  const data = options.data || readJson("data/db.json");
  const sources = options.sources || {
    html: read("immunization.html"),
    schedule: read("immunization-schedule.js"),
    pageJs: read("immunization.js"),
    citizen: `${read("citizen.html")}\n${read("citizen.js")}`,
    commission: `${read("index.html")}\n${read("app.js")}`,
    about: read("maternal-child-about.html"),
    docs: `${read("docs/immunization-program-2026.md")}\n${read("docs/maternal-child-policy.md")}`,
    packageSource: read("package.json")
  };
  const certificates = Array.isArray(data.birthCertificates) ? data.birthCertificates : [];
  const personalRecords = Array.isArray(data.personalRecords) ? data.personalRecords : [];
  const plans = buildPlansFromCertificates(certificates, personalRecords, { referenceDate: POLICY.referenceDate });
  const allRows = plans.flatMap((plan) => plan.rows);
  const hivPlan = buildPlan({ name: "HIV 暴露儿童", gender: "女", birthDate: "2026-06-01" }, { referenceDate: POLICY.referenceDate, healthProfile: "hiv-infected-severe" });
  const hbsagLowWeightPlan = buildPlan({ name: "低体重乙肝暴露儿童", gender: "男", birthDate: "2026-06-01" }, { referenceDate: POLICY.referenceDate, healthProfile: "hbsag-positive-low-weight" });
  const launchRequirements = LAUNCH_REQUIREMENTS.map((item) => ({
    ...item,
    ready: item.status === "ready",
    blocker: item.status !== "ready"
  }));
  const launchSummary = launchRequirements.reduce((acc, item) => {
    acc.total += 1;
    if (item.ready) acc.ready += 1;
    if (item.blocker) acc.sitePending += 1;
    if (item.severity === "P0") acc.p0 += 1;
    return acc;
  }, { total: 0, ready: 0, sitePending: 0, p0: 0 });
  const launchEvidence = launchRequirements.flatMap((item) =>
    (item.evidence || []).map((evidence) => ({ requirementId: item.id, evidence }))
  );
  const checks = [
    check("policy:version", POLICY.version === "2026" && sources.schedule.includes("国家免疫规划疫苗儿童免疫程序及说明（2026年版）"), "2026 policy version and source title are embedded", "policy"),
    check("rules:doses", DOSES.length >= 30 && ["HepB", "BCG", "IPV", "bOPV", "DTaP", "MMR", "JE-L", "JE-I", "MPSV-A", "MPSV-AC", "HepA-L", "HepA-I", "2vHPV"].every((code) => DOSES.some((item) => item.code === code)), `${DOSES.length} dose rules`, "rules"),
    check("rules:principles", GENERAL_PRINCIPLES.length >= 5 && SPECIAL_HEALTH_RULES.length >= 5, "general principles and special health-state rules are present", "rules"),
    check("rules:special-health-matrix", HEALTH_PROFILES.length >= 8 && hivPlan.rows.some((row) => row.code === "BCG" && row.safetyAction === "prohibit") && hivPlan.rows.some((row) => row.code === "MMR" && row.safetyAction === "prohibit") && hbsagLowWeightPlan.rows.some((row) => row.id === "HepB-LBW-4") && hbsagLowWeightPlan.summary.specialProgram >= 3, "HIV appendix table and HBsAg low-weight HepB special program are executable", "rules"),
    check("plans:birth-certificates", plans.length >= 3 && plans.every((plan) => plan.rows.length >= 20), `${plans.length} plans generated from birth certificates`, "data"),
    check("plans:status", allRows.some((row) => row.status === "逾期未种") && allRows.some((row) => row.status === "30天内到期"), "plans calculate overdue and due-soon states", "data"),
    check("ui:standalone", sources.html.includes("certificate-select") && sources.html.includes("health-profile-select") && sources.html.includes("immunization-table") && sources.pageJs.includes("safetyBadgeClass"), "standalone immunization page renders selectable plans and health-state safety labels", "ui"),
    check("ui:citizen", sources.citizen.includes("renderImmunizationPlanCards") && sources.citizen.includes("免疫规划（2026版）"), "citizen portal surfaces immunization schedule", "ui"),
    check("ui:commission", sources.commission.includes("computeImmunizationSummary") && sources.commission.includes("免疫逾期"), "commission portal surfaces immunization risk metrics", "ui"),
    check("docs:coverage", sources.docs.includes("2026 版程序覆盖") && sources.docs.includes("2vHPV") && sources.about.includes("immunization.html"), "docs and About link immunization program", "docs"),
    check("ui:launch-board", sources.html.includes("immunization-launch-board") && sources.pageJs.includes("renderLaunchBoard") && sources.pageJs.includes("launchRequirementBadgeClass"), "standalone page renders launch blockers and evidence ledger", "ui"),
    check("launch:requirements", launchSummary.total >= 8 && launchSummary.p0 >= 5 && launchSummary.sitePending >= 4, `${launchSummary.total} launch requirements / ${launchSummary.sitePending} site-pending blockers`, "launch"),
    check("launch:evidence-ledger", launchEvidence.length >= launchSummary.total * 2 && launchRequirements.every((item) => item.owner && item.nextAction), `${launchEvidence.length} launch evidence references with owners and next actions`, "launch"),
    check("launch:production-boundary", launchSummary.sitePending > 0 && launchRequirements.every((item) => ["ready", "site-pending"].includes(item.status)), "formal production go-live remains blocked until site evidence is signed", "launch"),
    check("release:script", sources.packageSource.includes("immunization:readiness") && sources.packageSource.includes("scripts/immunization-readiness.js"), "package script is available", "release")
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    module: "immunization-program",
    policy: POLICY,
    summary: {
      checks: checks.length,
      passed: checks.filter((item) => item.passed).length,
      doseRules: DOSES.length,
      plans: plans.length,
      overdue: allRows.filter((row) => row.status === "逾期未种").length,
      dueSoon: allRows.filter((row) => row.status === "30天内到期").length,
      healthProfiles: HEALTH_PROFILES.length,
      hivProhibited: hivPlan.summary.prohibited,
      hbsagSpecialProgram: hbsagLowWeightPlan.summary.specialProgram,
      launchRequirements: launchSummary.total,
      launchReady: launchSummary.ready,
      launchSitePending: launchSummary.sitePending,
      launchEvidence: launchEvidence.length
    },
    formalGoLiveState: launchSummary.sitePending === 0 ? "ready-for-production" : "blocked-until-site-evidence-signed",
    launchRequirements,
    launchEvidence,
    artifacts: {
      ruleEngine: "immunization-schedule.js",
      page: "immunization.html",
      pageScript: "immunization.js",
      doc: "docs/immunization-program-2026.md",
      report: "release/immunization-readiness-report.md"
    },
    checks
  };
}

function renderMarkdown(report) {
  const rows = report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.category} | ${item.id} | ${String(item.detail || "").replace(/\|/g, "/")} |`);
  const launchRows = (report.launchRequirements || []).map((item) =>
    `| ${item.ready ? "READY" : "SITE-PENDING"} | ${item.severity} | ${item.category} | ${item.title} | ${item.owner} | ${String(item.nextAction || "").replace(/\|/g, "/")} |`
  );
  const evidenceRows = (report.launchEvidence || []).map((item) => `| ${item.requirementId} | ${String(item.evidence || "").replace(/\|/g, "/")} |`);
  return [
    "# Immunization program readiness report",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Policy: ${report.policy.name}`,
    `- Dose rules: ${report.summary.doseRules}`,
    `- Generated plans: ${report.summary.plans}`,
    `- Overdue doses: ${report.summary.overdue}`,
    `- Due soon doses: ${report.summary.dueSoon}`,
    `- Formal go-live state: ${report.formalGoLiveState}`,
    `- Launch requirements: ${report.summary.launchReady}/${report.summary.launchRequirements} ready; ${report.summary.launchSitePending} site-pending`,
    "",
    "## Artifacts",
    "",
    `- Rule engine: ${report.artifacts.ruleEngine}`,
    `- Page: ${report.artifacts.page}`,
    `- Documentation: ${report.artifacts.doc}`,
    `- Report: ${report.artifacts.report}`,
    "",
    "## Checks",
    "",
    "| Result | Category | Check | Detail |",
    "|---|---|---|---|",
    ...rows,
    "",
    "## Launch requirements",
    "",
    "| State | Severity | Category | Requirement | Owner | Next action |",
    "|---|---|---|---|---|---|",
    ...launchRows,
    "",
    "## Evidence ledger",
    "",
    "| Requirement | Evidence |",
    "|---|---|",
    ...evidenceRows,
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
  const report = buildImmunizationReadinessReport();
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
  buildImmunizationReadinessReport,
  parseArgs,
  renderMarkdown,
  writeOutput
};
