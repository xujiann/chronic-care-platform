const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  buildPublicHealthCoordinationReadiness,
  parseArgs,
  renderMarkdown,
  writeOutput
} = require("../scripts/public-health-coordination-readiness");

test("coordination readiness accepts the complete eight-domain functional increment", () => {
  const report = buildPublicHealthCoordinationReadiness();

  assert.equal(report.ok, true);
  assert.equal(report.functionalState, "eight-domain-coordination-complete");
  assert.equal(report.formalGoLiveState, "blocked-until-t00-route-writer-production-endpoints-and-site-evidence-verified");
  assert.equal(report.summary.checks, 32);
  assert.equal(report.summary.passed, 32);
  assert.equal(report.summary.lanes, 8);
  assert.equal(report.summary.structurallyReady, 8);
  assert.equal(report.summary.handoffs, 8);
  assert.equal(report.summary.acceptanceClosed, 8);
  assert.equal(report.summary.auditEntries, 32);
  assert.equal(report.center.productionReady, false);
  assert.equal(report.acceptanceScenario.productionReady, false);
  assert.equal(report.remainingT00Integration.length, 3);
});

test("coordination readiness fails when the page panel contract is absent", () => {
  const report = buildPublicHealthCoordinationReadiness({ publicHealthHtml: "<html></html>" });
  const panelCheck = report.checks.find((item) => item.id === "frontend:panel");

  assert.equal(report.ok, false);
  assert.equal(panelCheck.passed, false);
});

test("coordination readiness renders and writes machine and human reports", () => {
  const report = buildPublicHealthCoordinationReadiness();
  const markdown = renderMarkdown(report);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "public-health-coordination-"));
  const output = path.join(directory, "report.json");
  const markdownOutput = path.join(directory, "report.md");

  assert.match(markdown, /eight-domain coordination readiness/);
  assert.match(markdown, /8 business closures/);
  assert.deepEqual(parseArgs([`--output=${output}`, `--markdown=${markdownOutput}`]), {
    output,
    markdown: markdownOutput
  });

  writeOutput(report, { output, markdown: markdownOutput });
  assert.equal(JSON.parse(fs.readFileSync(output, "utf8")).summary.acceptanceClosed, 8);
  assert.match(fs.readFileSync(markdownOutput, "utf8"), /Remaining T00 integration/);
});
