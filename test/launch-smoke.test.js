const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { buildLaunchSmokeReport, parseArgs, renderMarkdown, writeOutput } = require("../scripts/launch-smoke");

const ROOT = path.resolve(__dirname, "..");
const RELEASE_FIXTURE = {
  artifactExists: () => true,
  releaseReport: { ok: true, summary: { passed: 242, total: 243, failed: 0 } },
  cutover: { checklist: Array.from({ length: 10 }, (_, index) => ({ id: `cutover-${index + 1}` })) }
};

test("launch smoke report validates offline runtime routes and release artifacts", async () => {
  const report = await buildLaunchSmokeReport(RELEASE_FIXTURE);
  const markdown = renderMarkdown(report);

  assert.equal(report.ok, true);
  assert.equal(report.summary.failed, 0);
  assert.equal(report.checks.some((item) => item.id === "launch:script" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "launch:routes" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "launch:artifacts" && item.passed), true);
  assert.equal(report.routes.includes("/api/health"), true);
  assert.equal(report.routes.includes("/api/digital-hospital/launch-readiness"), true);
  assert.equal(report.routes.includes("/api/digital-hospital/production-evidence-packets"), true);
  assert.equal(report.routes.includes("/api/digital-hospital/launch-command-briefs"), true);
  assert.equal(report.routes.includes("/api/digital-hospital/formal-cutover-approvals"), true);
  assert.equal(report.artifacts.includes("release/production-cutover-checklist.md"), true);
  assert.equal(report.artifacts.includes("release/digital-hospital-standards-readiness-report.md"), true);
  assert.match(markdown, /Launch smoke report/);
  assert.match(markdown, /offline-source-check/);
});

test("launch smoke report can run a live health check when a base URL is supplied", async () => {
  const fetcher = async (url) => ({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, url })
  });
  const report = await buildLaunchSmokeReport({ ...RELEASE_FIXTURE, baseUrl: "http://localhost:5173/", fetcher });

  assert.equal(report.ok, true);
  assert.equal(report.summary.liveChecks, 1);
  assert.equal(report.checks.some((item) => item.id === "live:health" && item.passed && /HTTP 200/.test(item.detail)), true);
});

test("launch smoke parser and writer keep artifact paths", async (t) => {
  const outputDir = path.join(ROOT, "tmp", "launch-smoke-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const parsed = parseArgs(["--base-url=http://localhost:5173", "--output=tmp/launch-smoke-test/report.json", "--markdown=tmp/launch-smoke-test/report.md"]);
  assert.equal(parsed.baseUrl, "http://localhost:5173");
  assert.equal(parsed.output, "tmp/launch-smoke-test/report.json");
  assert.equal(parsed.markdown, "tmp/launch-smoke-test/report.md");

  const report = await buildLaunchSmokeReport(RELEASE_FIXTURE);
  writeOutput(report, parsed);

  const writtenJson = JSON.parse(fs.readFileSync(path.join(outputDir, "report.json"), "utf8"));
  const writtenMarkdown = fs.readFileSync(path.join(outputDir, "report.md"), "utf8");
  assert.equal(writtenJson.ok, true);
  assert.match(writtenMarkdown, /Runtime Routes/);
});

test("launch smoke remains blocked when generated release evidence is absent", async () => {
  const report = await buildLaunchSmokeReport({ artifactExists: () => false, releaseReport: null, cutover: null });
  assert.equal(report.ok, false);
  assert.equal(report.checks.some((item) => item.id === "launch:artifacts" && !item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "launch:releaseReport" && !item.passed), true);
});
