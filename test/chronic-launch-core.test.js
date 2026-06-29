const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  CORE_ITEMS,
  buildChronicLaunchCoreReport,
  renderMarkdown,
  writeOutput
} = require("../scripts/chronic-launch-core");

const ROOT = path.resolve(__dirname, "..");

test("chronic launch core report covers the first five production work packages", () => {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8"));
  const report = buildChronicLaunchCoreReport({ data });

  assert.equal(report.ok, true);
  assert.equal(CORE_ITEMS.length, 5);
  assert.equal(report.summary.readyItems, 5);
  assert.equal(report.summary.items, 5);
  assert.equal(report.summary.closureRows >= 14, true);
  assert.equal(report.summary.signoffs, 6);
  assert.equal(report.summary.signedSignoffs, 6);
  assert.equal(report.items.every((item) => item.ready), true);
  assert.equal(report.items.every((item) => item.closureReady), true);
  assert.equal(report.items.some((item) => item.id === "institution-systems" && item.collectionEvidence.rows >= 3), true);
  assert.equal(report.items.some((item) => item.id === "identity-scope" && item.collectionEvidence.rows >= 3), true);
  assert.equal(report.items.some((item) => item.id === "message-channels" && item.collectionEvidence.rows >= 3), true);
  assert.equal(report.items.some((item) => item.id === "quality-model" && item.collectionEvidence.rows >= 3), true);
  assert.equal(report.items.some((item) => item.id === "pharmacy-insurance" && item.collectionEvidence.rows >= 2), true);
  assert.equal(report.checks.some((item) => item.id === "launch-core:actionClosure" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "launch-core:siteSignoffs" && item.passed), true);
  assert.equal(report.apiSurface.includes("GET /api/chronic/launch-core"), true);
  assert.equal(report.apiSurface.includes("POST /api/chronic/launch-core/actions"), true);
});

test("chronic launch core report fails when an evidence collection is missing", () => {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8"));
  data.chronicMessageChannels = [];
  const report = buildChronicLaunchCoreReport({ data });

  assert.equal(report.ok, false);
  assert.equal(report.items.find((item) => item.id === "message-channels").ready, false);
});

test("chronic launch core report fails when closure or signoff evidence is missing", () => {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8"));
  data.chronicMessageChannels = data.chronicMessageChannels.map((item) => ({ ...item, completionStatus: "" }));
  let report = buildChronicLaunchCoreReport({ data });

  assert.equal(report.ok, false);
  assert.equal(report.checks.some((item) => item.id === "launch-core:actionClosure" && !item.passed), true);

  data.chronicMessageChannels = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8")).chronicMessageChannels;
  data.chronicLaunchCoreSignoffs = [];
  report = buildChronicLaunchCoreReport({ data });

  assert.equal(report.ok, false);
  assert.equal(report.checks.some((item) => item.id === "launch-core:siteSignoffs" && !item.passed), true);
});

test("chronic launch core report renders and writes release artifacts", (t) => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "chronic-launch-core-"));
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const report = buildChronicLaunchCoreReport();
  const markdown = renderMarkdown(report);
  const written = writeOutput(report, {
    output: path.join(outputDir, "chronic-launch-core.json"),
    markdown: path.join(outputDir, "chronic-launch-core.md")
  });

  assert.match(markdown, /Chronic launch core readiness/);
  assert.match(markdown, /institution-systems/);
  assert.match(markdown, /Site Signoffs/);
  assert.equal(JSON.parse(fs.readFileSync(written.output, "utf8")).ok, true);
  assert.match(fs.readFileSync(written.markdown, "utf8"), /pharmacy-insurance/);
});
