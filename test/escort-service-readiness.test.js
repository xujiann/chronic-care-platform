const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildEscortServiceReadinessReport,
  renderMarkdown,
  writeReport
} = require("../scripts/escort-service-readiness");

test("escort service readiness validates policy, registry, workforce, orders and APIs", () => {
  const report = buildEscortServiceReadinessReport();
  assert.equal(report.ok, true);
  assert.equal(report.boundaries.includes("provider registry"), true);
  assert.equal(report.boundaries.includes("quality monitoring"), true);
  assert.equal(report.summary.providers >= 3, true);
  assert.equal(report.summary.trainedWorkers >= 3, true);
  assert.equal(report.summary.orders >= 3, true);
  assert.equal(report.summary.subsidyOrders >= 1, true);
  assert.equal(report.checks.some((item) => item.id === "escort:api" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "escort:hospitalInterface" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "escort:hospitalInterfaceDoc" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "escort:frontend" && item.passed), true);
  assert.match(renderMarkdown(report), /Medical escort service readiness report/);
  assert.match(renderMarkdown(report), /Hospital-confirmed orders/);
});

test("escort service readiness writes release artifacts", (t) => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "escort-readiness-"));
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const report = buildEscortServiceReadinessReport();
  const output = path.join(outputDir, "escort-service-readiness-report.json");
  const markdown = path.join(outputDir, "escort-service-readiness-report.md");
  writeReport(report, output, markdown);
  const json = JSON.parse(fs.readFileSync(output, "utf8"));
  const md = fs.readFileSync(markdown, "utf8");
  assert.equal(json.ok, true);
  assert.equal(json.escortServiceReadiness.ok, true);
  assert.match(md, /Subsidy orders/);
});
