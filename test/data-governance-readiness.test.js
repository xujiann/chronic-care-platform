const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { buildDataGovernanceReadiness, parseArgs, renderMarkdown, writeOutput } = require("../scripts/data-governance-readiness");

const ROOT = path.resolve(__dirname, "..");

test("data governance readiness covers assets dictionaries lineage and blockers", () => {
  const report = buildDataGovernanceReadiness();
  assert.equal(report.ok, true);
  assert.equal(report.summary.assets >= 7, true);
  assert.equal(report.summary.sourceSystems >= 7, true);
  assert.equal(report.summary.dictionaries >= 6, true);
  assert.equal(report.summary.lineage >= 7, true);
  assert.equal(report.summary.busChannels >= 4, true);
  assert.equal(report.onsiteBlockers.length >= 3, true);
  assert.equal(report.lineage.every((item) => item.contractPresent && item.targetCollectionPresent && item.signatureReady && item.idempotencyReady), true);
  assert.equal(report.busChannels.every((item) => item.owner && item.producerCollections.length && item.consumerModules.length && item.evidence.length), true);
});

test("data governance readiness fails when asset catalog is missing", () => {
  const report = buildDataGovernanceReadiness({ assets: [] });
  assert.equal(report.ok, false);
  assert.equal(report.checks.some((item) => item.id === "data-governance:asset-catalog" && !item.passed), true);
});

test("data governance readiness keeps release wiring honest", () => {
  const report = buildDataGovernanceReadiness({ pkg: { scripts: {} }, readme: "", deployment: "" });
  assert.equal(report.ok, false);
  assert.equal(report.checks.some((item) => item.id === "data-governance:release-wiring" && !item.passed), true);
});

test("data governance readiness renders writes and parses output flags", (t) => {
  const outputDir = path.join(ROOT, "tmp", "data-governance-readiness-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const report = buildDataGovernanceReadiness();
  const markdown = renderMarkdown(report);
  assert.match(markdown, /Data governance readiness report/);
  assert.match(markdown, /HIS/);
  assert.match(markdown, /Platform bus channels/);
  assert.match(markdown, /external blocked/);

  writeOutput(report, {
    output: path.join("tmp", "data-governance-readiness-test", "data-governance-readiness-report.json"),
    markdown: path.join("tmp", "data-governance-readiness-test", "data-governance-readiness-report.md")
  });

  const writtenJson = JSON.parse(fs.readFileSync(path.join(outputDir, "data-governance-readiness-report.json"), "utf8"));
  const writtenMarkdown = fs.readFileSync(path.join(outputDir, "data-governance-readiness-report.md"), "utf8");
  assert.equal(writtenJson.ok, true);
  assert.match(writtenMarkdown, /Standard dictionaries/);

  const parsed = parseArgs(["--output=release/data-governance-readiness-report.json", "--markdown=release/data-governance-readiness-report.md"]);
  assert.equal(parsed.output, "release/data-governance-readiness-report.json");
  assert.equal(parsed.markdown, "release/data-governance-readiness-report.md");
});
