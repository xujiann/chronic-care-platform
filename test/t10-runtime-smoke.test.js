"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { buildSpecialtyCutoverPack } = require("../emergency-specialty-cutover");
const {
  buildT10RuntimeSmokeReport,
  buildOfflineChecks,
  parseArgs,
  renderMarkdown,
  writeOutput
} = require("../scripts/t10-runtime-smoke");

const ROOT = path.resolve(__dirname, "..");

function smokeFixture() {
  const pack = buildSpecialtyCutoverPack({ generatedAt: "2026-07-24T00:00:00.000Z" });
  return {
    pack,
    writeCutoverArtifacts: false,
    exists: (relativePath) => ["release/t10-specialty-cutover-pack.json", "release/t10-specialty-cutover-pack.md"].includes(relativePath),
    html: '<div id="runtime-smoke-plan"></div><script src="./t10-specialty-cutover.js?v=institution-deployment-gate"></script>',
    client: 'fetch("./release/t10-specialty-cutover-pack.json"); function renderRuntimeSmokePlan() {}',
    releaseReportSource: "function specialtyCutoverChecks() { return ['specialtyCutover:runtimeSmokePlan']; }"
  };
}

test("T10 runtime smoke report validates code-side launch gates without closing site evidence", async () => {
  const report = await buildT10RuntimeSmokeReport(smokeFixture());
  const markdown = renderMarkdown(report);

  assert.equal(report.ok, true);
  assert.equal(report.summary.failed, 0);
  assert.equal(report.launchMode, "controlled-rehearsal-only");
  assert.equal(report.formalGoLiveState, "blocked-until-site-evidence-signed");
  assert.ok(report.checks.some((item) => item.id === "t10:production-boundary" && item.passed));
  assert.ok(report.checks.some((item) => item.id === "t10:runtime-smoke-suites" && item.passed));
  assert.ok(report.checks.some((item) => item.id === "t10:independent-module-selection" && item.passed));
  assert.ok(report.checks.some((item) => item.id === "t10:institution-deployment-gate" && item.passed));
  assert.ok(report.checks.some((item) => item.id === "t10:route-contracts" && item.passed));
  assert.match(markdown, /T10 runtime smoke report/);
  assert.match(markdown, /smoke-server-api/);
});

test("T10 runtime smoke can include a live cutover API check", async () => {
  const fetcher = async (url) => ({
    ok: true,
    status: 200,
    json: async () => ({ module: "t10-emergency-blood-imaging-physical-exam-cutover", url })
  });
  const report = await buildT10RuntimeSmokeReport({
    ...smokeFixture(),
    baseUrl: "http://localhost:5173/",
    fetcher
  });

  assert.equal(report.ok, true);
  assert.equal(report.summary.liveChecks, 1);
  assert.ok(report.checks.some((item) => item.id === "t10:live-cutover-pack" && item.passed && /HTTP 200/.test(item.detail)));
});

test("T10 runtime smoke parser and writer keep custom artifact paths", async (t) => {
  const outputDir = path.join(ROOT, "tmp", "t10-runtime-smoke-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const parsed = parseArgs(["--base-url=http://localhost:5173", "--output=tmp/t10-runtime-smoke-test/report.json", "--markdown=tmp/t10-runtime-smoke-test/report.md"]);
  assert.equal(parsed.baseUrl, "http://localhost:5173");
  assert.equal(parsed.output, "tmp/t10-runtime-smoke-test/report.json");
  assert.equal(parsed.markdown, "tmp/t10-runtime-smoke-test/report.md");

  const report = await buildT10RuntimeSmokeReport(smokeFixture());
  writeOutput(report, parsed);

  const writtenJson = JSON.parse(fs.readFileSync(path.join(outputDir, "report.json"), "utf8"));
  const writtenMarkdown = fs.readFileSync(path.join(outputDir, "report.md"), "utf8");
  assert.equal(writtenJson.ok, true);
  assert.match(writtenMarkdown, /Runtime Smoke Suites/);
});

test("T10 runtime smoke fails when route contracts drift from the cutover pack", () => {
  const fixture = smokeFixture();
  const badPack = {
    ...fixture.pack,
    runtimeSmokePlan: {
      ...fixture.pack.runtimeSmokePlan,
      trackRoutes: fixture.pack.runtimeSmokePlan.trackRoutes.map((route) => route.trackId === "emergency-life-chain" ? { ...route, api: "/api/wrong" } : route)
    }
  };
  const checks = buildOfflineChecks(badPack, fixture);

  assert.equal(checks.some((item) => item.id === "t10:route-contracts" && !item.passed), true);
});

test("T10 runtime smoke blocks an invalid institution deployment contract", () => {
  const fixture = smokeFixture();
  const badPack = {
    ...fixture.pack,
    institutionDeploymentGate: {
      ...fixture.pack.institutionDeploymentGate,
      ok: false,
      status: "deployment-contract-blocked",
      hardStops: ["api-allowlist"],
      summary: { total: 9, passed: 8, failed: 1 }
    }
  };
  const checks = buildOfflineChecks(badPack, fixture);

  assert.equal(checks.some((item) => item.id === "t10:institution-deployment-gate" && !item.passed), true);
});
