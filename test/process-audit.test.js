const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { buildProcessAuditReport, parseArgs, renderMarkdown, writeOutput } = require("../scripts/process-audit");

const ROOT = path.resolve(__dirname, "..");

test("process audit validates full process evidence domains", () => {
  const report = buildProcessAuditReport();
  assert.equal(report.ok, true);
  assert.equal(report.evidenceDomains.length >= 6, true);
  assert.equal(report.evidenceDomains.every((item) => item.passed), true);
  assert.equal(report.evidenceDomains.some((item) => item.id === "site-readiness" && item.passed), true);
  assert.equal(report.evidenceDomains.some((item) => item.id === "insurance-and-pharmacy" && item.evidence.includes("drugConsumableSupervisions")), true);
  assert.equal(report.checks.some((item) => item.id === "process:siteReadinessPack" && item.passed), true);
  assert.equal(report.ledgers.chronic.total >= 5, true);
  assert.equal(report.ledgers.county.total >= 4, true);
  assert.equal(report.processRows.length >= 10, true);
});

test("process audit fails when chronic and county ledgers are absent", () => {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data/db.json"), "utf8"));
  data.chronicAcceptanceLedger = [];
  data.countyAcceptanceLedger = [];
  const report = buildProcessAuditReport({ data });
  assert.equal(report.ok, false);
  assert.equal(report.checks.some((item) => item.id === "process:chronicAcceptance" && !item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "process:countyAcceptance" && !item.passed), true);
});

test("process audit fails when site readiness pack evidence is absent", () => {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data/db.json"), "utf8"));
  const report = buildProcessAuditReport({
    data,
    pkg: { scripts: {} },
    readme: "",
    deployment: "",
    serverSource: "",
    workbenchSource: ""
  });
  assert.equal(report.ok, false);
  assert.equal(report.checks.some((item) => item.id === "process:siteReadinessPack" && !item.passed), true);
  assert.equal(report.evidenceDomains.some((item) => item.id === "site-readiness" && !item.passed), true);
});

test("process audit renders and writes release artifacts", (t) => {
  const outputDir = path.join(ROOT, "tmp", "process-audit-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const report = buildProcessAuditReport();
  const markdown = renderMarkdown(report);
  assert.match(markdown, /Full process audit report/);
  assert.match(markdown, /Evidence domains/);
  assert.match(markdown, /drugConsumableSupervisions/);
  assert.match(markdown, /Process matrix/);

  writeOutput(report, {
    output: path.join("tmp", "process-audit-test", "process-audit-report.json"),
    markdown: path.join("tmp", "process-audit-test", "process-audit-report.md")
  });

  const writtenJson = JSON.parse(fs.readFileSync(path.join(outputDir, "process-audit-report.json"), "utf8"));
  const writtenMarkdown = fs.readFileSync(path.join(outputDir, "process-audit-report.md"), "utf8");
  assert.equal(writtenJson.ok, true);
  assert.match(writtenMarkdown, /security-and-cutover/);
  assert.match(writtenMarkdown, /site-readiness/);
});

test("process audit CLI parser keeps output flags", () => {
  const parsed = parseArgs(["--output=release/process-audit-report.json", "--markdown=release/process-audit-report.md"]);
  assert.equal(parsed.output, "release/process-audit-report.json");
  assert.equal(parsed.markdown, "release/process-audit-report.md");
});
