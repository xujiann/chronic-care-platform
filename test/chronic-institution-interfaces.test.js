const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildChronicInstitutionInterfaceReport,
  renderMarkdown,
  writeOutput
} = require("../scripts/chronic-institution-interfaces");

const ROOT = path.resolve(__dirname, "..");

test("chronic institution interface report covers pre-launch contracts", () => {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8"));
  const report = buildChronicInstitutionInterfaceReport({ data });

  assert.equal(report.ok, true);
  assert.equal(report.summary.contracts, 8);
  assert.equal(report.summary.readyContracts, 8);
  assert.equal(report.contracts.every((item) => item.routeReady && item.docReady && item.testReady), true);
  assert.equal(report.contracts.some((item) => item.id === "chronic-device-measurement-v1" && item.requiredFields.includes("externalId?")), true);
  assert.equal(report.launchEvidence.authorization, true);
  assert.equal(report.launchEvidence.seedEvidence, true);
});

test("chronic institution interface report fails when document routes are missing", () => {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8"));
  const report = buildChronicInstitutionInterfaceReport({ data, doc: "# incomplete" });

  assert.equal(report.ok, false);
  assert.equal(report.checks.find((item) => item.id === "institution-interfaces:docs").passed, false);
  assert.equal(report.summary.readyContracts < report.summary.contracts, true);
});

test("chronic institution interface report renders and writes release artifacts", (t) => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "chronic-institution-interfaces-"));
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const report = buildChronicInstitutionInterfaceReport();
  const markdown = renderMarkdown(report);
  const written = writeOutput(report, {
    output: path.join(outputDir, "chronic-institution-interfaces.json"),
    markdown: path.join(outputDir, "chronic-institution-interfaces.md")
  });

  assert.match(markdown, /Chronic institution interface readiness/);
  assert.match(markdown, /chronic-pharmacy-callback-v1/);
  assert.equal(JSON.parse(fs.readFileSync(written.output, "utf8")).ok, true);
  assert.match(fs.readFileSync(written.markdown, "utf8"), /chronic-reminder-outreach-v1/);
});
