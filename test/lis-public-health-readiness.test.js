const assert = require("node:assert/strict");
const test = require("node:test");

const { buildLisPublicHealthReadiness, parseArgs, renderMarkdown } = require("../scripts/lis-public-health-readiness");

test("LIS public-health readiness reports a handoff-ready but production-blocked increment", () => {
  const report = buildLisPublicHealthReadiness();
  assert.equal(report.ok, true);
  assert.equal(report.handoffReady, true);
  assert.equal(report.productionReady, false);
  assert.equal(report.checks.every((item) => item.passed), true);
  assert.equal(report.integrationHooks.serverImportsReady, false);
  assert.equal(report.blockers.some((item) => /T00/.test(item)), true);
  assert.match(renderMarkdown(report), /T00 integration hooks/);
  assert.match(renderMarkdown(report), /Production ready: no/);
});

test("LIS public-health readiness fails when minimization controls disappear", () => {
  const report = buildLisPublicHealthReadiness({ integrationSource: "validateLisReport buildDiagnosticReport publicHealthReportRequired payloadDigest" });
  assert.equal(report.ok, false);
  assert.equal(report.checks.some((item) => item.id === "lisPublicHealth:landing" && !item.passed), true);
});

test("LIS public-health readiness fails when keyed-reference controls disappear", () => {
  const report = buildLisPublicHealthReadiness({
    connectorSource: "PUBLIC_HEALTH_DIRECT_REPORT_URL HMAC-SHA256 X-Idempotency-Key verifyDirectReportCallback nonceDigest"
  });
  assert.equal(report.ok, false);
  assert.equal(report.checks.some((item) => item.id === "lisPublicHealth:connector" && !item.passed), true);
});

test("LIS public-health readiness CLI parser keeps output flags", () => {
  const flags = parseArgs(["--write=false", "--output=tmp/lis-public-health.json"]);
  assert.equal(flags.write, "false");
  assert.equal(flags.output, "tmp/lis-public-health.json");
});
