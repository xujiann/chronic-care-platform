const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  applyResearchProjectAcceptanceAction,
  buildResearchProjectAcceptanceCenter,
  renderResearchProjectAcceptanceMarkdown,
  seedResearchProjectAcceptanceItems
} = require("../research-project-acceptance");
const { parseArgs, writeOutput } = require("../scripts/research-project-acceptance-readiness");

const ROOT = path.resolve(__dirname, "..");
const hospital = { id: "u-hospital", name: "医院项目管理员", role: "institution" };
const recorder = { id: "u-health", name: "项目登记员", role: "commission" };
const reviewer = { id: "u-city", name: "独立复核员", role: "commission" };

test("research project center maps all application requirements and outcomes", () => {
  const center = buildResearchProjectAcceptanceCenter({});
  assert.equal(center.ok, true);
  assert.equal(center.project.id, "042020604");
  assert.equal(center.project.leadInstitution, "大连医科大学附属第二医院");
  assert.equal(center.summary.requirements, 6);
  assert.equal(center.summary.domains, 6);
  assert.equal(center.summary.reports, 2);
  assert.equal(center.summary.implementationPlans, 1);
  assert.equal(center.summary.traceabilityCoverage, 100);
  assert.equal(center.requirements.every((item) => item.traceabilityComplete), true);
  assert.equal(center.metrics.length, 11);
  assert.equal(center.formalAcceptanceState, "blocked-until-project-evidence-verified");
});

test("metric evidence must satisfy target and use independent verification", () => {
  let item = seedResearchProjectAcceptanceItems().find((entry) => entry.id === "metric-data-completeness");
  assert.throws(() => applyResearchProjectAcceptanceAction(item, {
    action: "record-evidence",
    evidenceRef: "DATA-QUALITY-001",
    measuredValue: 96,
    note: "登记试点数据质量报告",
    noPatientPii: false
  }, hospital), /noPatientPii/);

  item = applyResearchProjectAcceptanceAction(item, {
    action: "record-evidence",
    evidenceRef: "DATA-QUALITY-001",
    measuredValue: 94,
    note: "登记未达标的试点数据质量报告",
    noPatientPii: true
  }, hospital, new Date("2027-03-01T08:00:00.000Z"));
  assert.equal(item.status, "evidence-recorded");
  assert.throws(() => applyResearchProjectAcceptanceAction(item, {
    action: "submit-review",
    note: "尝试提交未达标指标"
  }, hospital), /does not meet/);

  item = applyResearchProjectAcceptanceAction(item, {
    action: "record-evidence",
    evidenceRef: "DATA-QUALITY-002",
    measuredValue: 96,
    note: "复测后完整率达到要求",
    noPatientPii: true
  }, hospital, new Date("2027-03-02T08:00:00.000Z"));
  item = applyResearchProjectAcceptanceAction(item, {
    action: "submit-review",
    note: "提交独立复核"
  }, hospital, new Date("2027-03-03T08:00:00.000Z"));
  assert.throws(() => applyResearchProjectAcceptanceAction(item, {
    action: "verify-evidence",
    note: "提交人尝试自行复核"
  }, { ...hospital, role: "commission" }), /independent reviewer/);
  item = applyResearchProjectAcceptanceAction(item, {
    action: "verify-evidence",
    note: "核对报告、样本范围和统计口径后通过"
  }, reviewer, new Date("2027-03-04T08:00:00.000Z"));
  assert.equal(item.status, "verified");
  assert.equal(item.reviewedBy, "u-city");
  assert.equal(item.sha256.length, 64);
  assert.throws(() => applyResearchProjectAcceptanceAction(item, {
    action: "record-evidence",
    evidenceRef: "DATA-QUALITY-003",
    measuredValue: 97,
    note: "不得绕过撤销流程覆盖已复核证据",
    noPatientPii: true
  }, recorder), /current status/);
});

test("all verified items unlock only the formal acceptance review gate", () => {
  const items = seedResearchProjectAcceptanceItems().map((item) => ({
    ...item,
    status: "verified",
    evidenceRef: `EVIDENCE-${item.id}`,
    sha256: "a".repeat(64),
    measuredValue: item.type === "metric" ? item.targetValue : null,
    reviewedBy: "independent-reviewer"
  }));
  const cr = items.find((item) => item.id === "metric-ahp-consistency");
  cr.measuredValue = 0.05;
  const center = buildResearchProjectAcceptanceCenter({ researchProjectAcceptanceItems: items });
  assert.equal(center.summary.verifiedRate, 100);
  assert.equal(center.formalAcceptanceState, "ready-for-formal-acceptance-review");
  assert.notEqual(center.formalAcceptanceState, "formally-accepted");
});

test("persisted status cannot bypass evidence integrity and metric targets", () => {
  const items = seedResearchProjectAcceptanceItems().map((item) => ({
    ...item,
    status: "verified",
    evidenceRef: `EVIDENCE-${item.id}`,
    sha256: "b".repeat(64),
    measuredValue: item.type === "metric" ? item.targetValue : null,
    reviewedBy: "independent-reviewer"
  }));
  items.find((item) => item.id === "metric-ahp-consistency").measuredValue = 0.05;
  items.find((item) => item.id === "metric-data-completeness").measuredValue = 80;
  items.find((item) => item.id === "report-comprehensive").sha256 = "";
  const center = buildResearchProjectAcceptanceCenter({ researchProjectAcceptanceItems: items });
  assert.equal(center.formalAcceptanceState, "blocked-until-project-evidence-verified");
  assert.equal(center.summary.verified, 18);
});

test("research project report renderer and CLI output preserve acceptance boundary", (t) => {
  const outputDir = path.join(ROOT, "tmp", "research-project-acceptance-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const center = buildResearchProjectAcceptanceCenter({});
  const markdown = renderResearchProjectAcceptanceMarkdown(center);
  assert.match(markdown, /委托任务追溯矩阵/);
  assert.match(markdown, /证据可追溯率/);
  assert.match(markdown, /blocked-until-project-evidence-verified/);
  const files = writeOutput(center, {
    output: "tmp/research-project-acceptance-test/report.json",
    markdown: "tmp/research-project-acceptance-test/report.md"
  });
  assert.equal(fs.existsSync(files.output), true);
  assert.match(fs.readFileSync(files.markdown, "utf8"), /数据与证据边界/);
  assert.deepEqual(parseArgs(["--output=a.json", "--markdown=b.md"]), { output: "a.json", markdown: "b.md" });
});

test("research project page and server expose guarded business operations", () => {
  const html = fs.readFileSync(path.join(ROOT, "research-project-acceptance.html"), "utf8");
  const ui = fs.readFileSync(path.join(ROOT, "research-project-acceptance-ui.js"), "utf8");
  const auth = fs.readFileSync(path.join(ROOT, "auth.js"), "utf8");
  const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
  assert.match(html, /科研项目验收追溯中心/);
  assert.match(html, /requireRole\(\["commission", "institution"\]\)/);
  assert.match(ui, /\/api\/research-project\/acceptance-center/);
  assert.match(auth, /"research-project-acceptance\.html": \["commission", "institution"\]/);
  assert.match(server, /\/api\/research-project\/acceptance-items/);
});
