const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { buildBloodSystemReadinessReport } = require("../scripts/blood-system-readiness");
const ROOT = path.resolve(__dirname, "..");

test("blood readiness gate covers safety closure and release wiring", () => {
  const report = buildBloodSystemReadinessReport();
  assert.equal(report.ok, true);
  assert.equal(report.passed, report.total);
  assert.equal(report.total >= 30, true);
  assert.equal(report.checks.some((item) => item.name === "冷链越限持久化隔离" && item.ok), true);
  assert.equal(report.checks.some((item) => item.name === "会话绑定配血双签" && item.ok), true);
});

test("blood readiness CLI emits the same passing report", () => {
  const run = spawnSync(process.execPath, [path.join(ROOT, "scripts", "blood-system-readiness.js")], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(run.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.passed, report.total);
});

test("blood readiness fails closed when the dashboard query projection is missing", () => {
  const report = buildBloodSystemReadinessReport({ dashboardQuery: "" });
  const projectionCheck = report.checks.find((item) => item.name === "事务证据实时回读");

  assert.equal(projectionCheck.ok, false);
  assert.equal(report.ok, false);
});
