const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  DOSES,
  HEALTH_PROFILES,
  POLICY,
  buildPlan,
  childFromCertificate
} = require("../immunization-schedule");
const {
  buildImmunizationReadinessReport,
  parseArgs,
  renderMarkdown,
  writeOutput
} = require("../scripts/immunization-readiness");

const ROOT = path.resolve(__dirname, "..");

test("2026 immunization schedule builds age-based plan from birth certificate", () => {
  const child = childFromCertificate({
    id: "birth-cert-demo",
    newbornName: "演示新生儿",
    newbornGender: "女",
    birthDateTime: "2026-06-01 09:18",
    certificateNo: "BC-DEMO"
  });
  const plan = buildPlan(child, { referenceDate: "2026-07-07" });
  const doseIds = plan.rows.map((row) => row.id);

  assert.equal(POLICY.version, "2026");
  assert.equal(DOSES.length >= 30, true);
  assert.equal(plan.summary.total >= 22, true);
  assert.equal(plan.summary.overdue >= 2, true);
  assert.equal(doseIds.includes("HepB-1"), true);
  assert.equal(doseIds.includes("BCG-1"), true);
  assert.equal(doseIds.includes("2vHPV-1"), true);
  assert.equal(plan.rows.find((row) => row.id === "HepB-1").route, "肌内注射");
  assert.equal(plan.rows.find((row) => row.id === "BCG-1").route, "皮内注射");
});

test("2026 immunization schedule evaluates special health status rules", () => {
  const child = { name: "特殊状态儿童", gender: "女", birthDate: "2026-06-01" };
  const hivPlan = buildPlan(child, { referenceDate: "2026-07-07", healthProfile: "hiv-infected-severe" });
  const hbsagPlan = buildPlan(child, { referenceDate: "2026-07-07", healthProfile: "hbsag-positive-low-weight" });

  assert.equal(HEALTH_PROFILES.length >= 8, true);
  assert.equal(hivPlan.rows.find((row) => row.code === "BCG").safetyAction, "prohibit");
  assert.equal(hivPlan.rows.find((row) => row.code === "MMR").safetyAction, "prohibit");
  assert.equal(hivPlan.summary.prohibited >= 4, true);
  assert.equal(hbsagPlan.rows.some((row) => row.id === "HepB-LBW-3"), true);
  assert.equal(hbsagPlan.rows.some((row) => row.id === "HepB-LBW-4"), true);
  assert.equal(hbsagPlan.summary.specialProgram >= 3, true);
});

test("immunization readiness report validates page, docs, citizen and commission integration", () => {
  const report = buildImmunizationReadinessReport();
  const markdown = renderMarkdown(report);

  assert.equal(report.ok, true);
  assert.equal(report.checks.every((item) => item.passed), true);
  assert.equal(report.artifacts.ruleEngine, "immunization-schedule.js");
  assert.equal(report.artifacts.page, "immunization.html");
  assert.equal(report.checks.some((item) => item.id === "ui:citizen"), true);
  assert.equal(report.checks.some((item) => item.id === "ui:commission"), true);
  assert.equal(report.checks.some((item) => item.id === "rules:special-health-matrix" && item.passed), true);
  assert.equal(report.summary.healthProfiles >= 8, true);
  assert.match(markdown, /Immunization program readiness report/);
  assert.match(markdown, /Dose rules/);
  assert.match(markdown, /immunization\.html/);
});

test("immunization readiness CLI parser and writer keep artifact paths", (t) => {
  const outputDir = path.join(ROOT, "tmp", "immunization-readiness-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const parsed = parseArgs(["--output=tmp/immunization-readiness-test/report.json", "--markdown=tmp/immunization-readiness-test/report.md"]);
  assert.equal(parsed.output, "tmp/immunization-readiness-test/report.json");
  assert.equal(parsed.markdown, "tmp/immunization-readiness-test/report.md");

  const report = buildImmunizationReadinessReport();
  writeOutput(report, parsed);

  const writtenJson = JSON.parse(fs.readFileSync(path.join(outputDir, "report.json"), "utf8"));
  const writtenMarkdown = fs.readFileSync(path.join(outputDir, "report.md"), "utf8");
  assert.equal(writtenJson.ok, true);
  assert.match(writtenMarkdown, /国家免疫规划疫苗儿童免疫程序及说明/);
});
