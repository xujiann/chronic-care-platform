const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  applyCitizenOperationsAction,
  buildCitizenOperationsCenter,
  buildCitizenOperationsPublic,
  buildCitizenOperationsReadiness,
  parseArgs,
  renderMarkdown,
  seedCitizenHospitalServiceConfigs,
  seedCitizenIdentityReviewCases,
  writeOutput
} = require("../scripts/citizen-operations-readiness");

const ROOT = path.resolve(__dirname, "..");

test("citizen operations readiness covers governance orders dual-surface UI and production boundary", () => {
  const report = buildCitizenOperationsReadiness();
  assert.equal(report.ok, true);
  assert.equal(report.summary.publishedContents >= 3, true);
  assert.equal(report.summary.activeAgreements >= 3, true);
  assert.equal(report.summary.pendingIdentityReviews >= 1, true);
  assert.equal(report.summary.enabledHospitals >= 2, true);
  assert.equal(report.summary.orders >= 7, true);
  assert.equal(report.summary.productionReadyHospitals, 0);
  assert.equal(report.checks.every((item) => item.passed), true);
});

test("citizen operations public feed excludes identity review and blacklist data", () => {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8"));
  const publicFeed = buildCitizenOperationsPublic(data);
  assert.equal(publicFeed.contents.every((item) => item.status === "published-demo"), true);
  assert.equal(publicFeed.agreements.every((item) => item.status === "active-demo"), true);
  assert.equal(publicFeed.hospitalServices.every((item) => item.status === "active-demo"), true);
  assert.equal("identityReviews" in publicFeed, false);
  assert.equal("blacklist" in publicFeed, false);
  assert.equal(publicFeed.hospitalServices.every((item) => !("onsiteBlocker" in item)), true);
});

test("citizen operations actions require notes and keep production gate closed", () => {
  const identity = seedCitizenIdentityReviewCases()[0];
  assert.throws(
    () => applyCitizenOperationsAction("identity-reviews", identity, { action: "approve" }, { name: "tester", role: "commission" }),
    /requires note/
  );
  const approved = applyCitizenOperationsAction(
    "identity-reviews",
    identity,
    { action: "approve", note: "demo identity review completed" },
    { name: "tester", role: "commission" }
  );
  assert.equal(approved.item.status, "approved-demo");
  assert.equal(approved.item.productionReady, false);
  assert.equal(approved.item.reviewer, "tester");
  assert.equal(approved.item.actionHistory.length, 1);

  const hospital = seedCitizenHospitalServiceConfigs()[2];
  const enabled = applyCitizenOperationsAction(
    "hospitals",
    hospital,
    { action: "enable-demo", note: "white-list demonstration only" },
    { name: "tester", role: "commission" }
  );
  assert.equal(enabled.item.status, "active-demo");
  assert.equal(enabled.item.launchScope, "white-list-demo");
  assert.equal(enabled.item.productionReady, false);
});

test("citizen operations center preserves external blockers", () => {
  const center = buildCitizenOperationsCenter({});
  assert.equal(center.ok, true);
  assert.equal(center.onsiteBlockers.length, 4);
  assert.match(center.boundary, /Government identity/);
  assert.equal(center.hospitalServices.every((item) => item.productionReady === false), true);
});

test("citizen operations readiness renders writes and parses output flags", (t) => {
  const outputDir = path.join(ROOT, "tmp", "citizen-operations-readiness-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const report = buildCitizenOperationsReadiness();
  const markdown = renderMarkdown(report);
  assert.match(markdown, /Citizen service operations readiness report/);
  assert.match(markdown, /Hospital service enablement/);
  writeOutput(report, {
    output: path.join("tmp", "citizen-operations-readiness-test", "report.json"),
    markdown: path.join("tmp", "citizen-operations-readiness-test", "report.md")
  });
  assert.equal(JSON.parse(fs.readFileSync(path.join(outputDir, "report.json"), "utf8")).ok, true);
  assert.match(fs.readFileSync(path.join(outputDir, "report.md"), "utf8"), /Production boundary/);
  const parsed = parseArgs(["--output=release/custom.json", "--markdown=release/custom.md", "--write=false"]);
  assert.equal(parsed.output, "release/custom.json");
  assert.equal(parsed.markdown, "release/custom.md");
  assert.equal(parsed.write, "false");
});
