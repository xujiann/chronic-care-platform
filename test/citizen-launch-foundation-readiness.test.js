const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildCitizenLaunchFoundationReadiness,
  renderMarkdown,
  writeReport
} = require("../scripts/citizen-launch-foundation-readiness");

test("citizen launch foundation readiness captures phase-one gates", () => {
  const phaseDoc = fs.readFileSync(path.join(__dirname, "..", "docs", "citizen-launch-foundation-plan.md"), "utf8");
  const report = buildCitizenLaunchFoundationReadiness({ phaseDoc });
  assert.equal(report.ok, true);
  assert.equal(report.phase, "Phase 1 - launch foundation");
  assert.equal(report.launchState, "controlled-pilot-ready");
  assert.deepEqual(report.summary.channels, ["mini-program", "app", "pwa"]);
  assert.equal(report.externalDependencies.some((item) => item.id === "sms-gateway"), true);
  assert.equal(report.externalDependencies.some((item) => item.id === "real-name-identity"), true);
  assert.equal(report.externalDependencies.some((item) => item.id === "guardian-relation"), true);
  assert.equal(report.checks.some((item) => item.id === "citizen-foundation:phone-login" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "citizen-foundation:mobile-install-shell" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "citizen-foundation:app-shortcuts" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "citizen-foundation:launch-gates" && item.passed), true);
  assert.match(renderMarkdown(report), /Citizen launch foundation readiness/);
  assert.match(renderMarkdown(report), /production SMS gateway/);
});

test("citizen launch foundation readiness writes release artifacts", (t) => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "citizen-launch-foundation-"));
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const phaseDoc = fs.readFileSync(path.join(__dirname, "..", "docs", "citizen-launch-foundation-plan.md"), "utf8");
  const report = buildCitizenLaunchFoundationReadiness({ phaseDoc });
  const output = path.join(outputDir, "citizen-launch-foundation-readiness.json");
  const markdown = path.join(outputDir, "citizen-launch-foundation-readiness.md");
  writeReport(report, output, markdown);
  const json = JSON.parse(fs.readFileSync(output, "utf8"));
  const md = fs.readFileSync(markdown, "utf8");
  assert.equal(json.ok, true);
  assert.equal(json.citizenLaunchFoundationReadiness.ok, true);
  assert.match(md, /External Dependencies/);
});
