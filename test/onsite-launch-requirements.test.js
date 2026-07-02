const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { buildOnsiteLaunchRequirements, parseArgs, renderMarkdown, writeOutput } = require("../scripts/onsite-launch-requirements");

const ROOT = path.resolve(__dirname, "..");

test("onsite launch requirements model field-owned go-live blockers", () => {
  const report = buildOnsiteLaunchRequirements();
  const markdown = renderMarkdown(report);

  assert.equal(report.ok, true);
  assert.equal(report.formalGoLiveState, "blocked-until-site-materials-signed");
  assert.equal(report.summary.requirements >= 12, true);
  assert.equal(report.summary.p0Requirements >= 10, true);
  assert.equal(report.requirements.some((item) => item.id === "OSL-04" && item.domain === "sms"), true);
  assert.equal(report.requirements.some((item) => item.id === "OSL-06" && item.domain === "resident-services"), true);
  assert.equal(report.requirements.some((item) => item.id === "OSL-12" && item.domain === "resident-mobile" && item.priority === "P1"), true);
  assert.equal(report.blockingConditions.some((item) => item.requirementId === "OSL-05" && item.owner === "institution-integration"), true);
  assert.equal(report.checks.some((item) => item.id === "onsite:site-pack" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "onsite:release-gates" && item.passed), true);
  assert.match(markdown, /On-site launch requirements/);
  assert.match(markdown, /blocked-until-site-materials-signed/);
  assert.match(markdown, /release\/production-cutover-checklist\.md/);
});

test("onsite launch requirements can render and write artifacts", (t) => {
  const outputDir = path.join(ROOT, "tmp", "onsite-launch-requirements-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const parsed = parseArgs(["--config-env=.env.example", "--output=tmp/onsite-launch-requirements-test/report.json", "--markdown=tmp/onsite-launch-requirements-test/report.md"]);
  assert.equal(parsed.envFile, ".env.example");
  assert.equal(parsed.output, "tmp/onsite-launch-requirements-test/report.json");
  assert.equal(parsed.markdown, "tmp/onsite-launch-requirements-test/report.md");

  const report = buildOnsiteLaunchRequirements(parsed);
  writeOutput(report, parsed);

  const writtenJson = JSON.parse(fs.readFileSync(path.join(outputDir, "report.json"), "utf8"));
  const writtenMarkdown = fs.readFileSync(path.join(outputDir, "report.md"), "utf8");
  assert.equal(writtenJson.ok, true);
  assert.equal(writtenJson.requirements.some((item) => item.evidence.includes("release/launch-smoke-report.md")), true);
  assert.match(writtenMarkdown, /Requirement Matrix/);
  assert.match(writtenMarkdown, /Blocking Conditions/);
});
