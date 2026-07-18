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
  assert.equal(report.summary.contracts, 17);
  assert.equal(report.summary.readyContracts, 17);
  assert.equal(report.contracts.every((item) => item.routeReady && item.docReady && item.testReady), true);
  assert.equal(report.contracts.some((item) => item.id === "chronic-device-measurement-v1" && item.requiredFields.includes("externalId?")), true);
  assert.equal(report.contracts.some((item) => item.id === "chronic-followup-escalation-v1" && item.path === "/api/chronic/followup-escalations"), true);
  assert.equal(report.contracts.some((item) => item.id === "chronic-referral-continuity-v1" && item.path === "/api/chronic/referral-continuity"), true);
  assert.equal(report.contracts.some((item) => item.id === "chronic-archive-standard-v1" && item.path === "/api/chronic/archive-standard"), true);
  assert.equal(report.contracts.some((item) => item.id === "chronic-pathway-quality-v1" && item.path === "/api/chronic/pathway-quality"), true);
  assert.equal(report.contracts.some((item) => item.id === "chronic-pharmacy-insurance-closure-v1" && item.path === "/api/chronic/pharmacy-insurance-closure"), true);
  assert.equal(report.contracts.some((item) => item.id === "chronic-production-safety-v1" && item.path === "/api/chronic/production-safety"), true);
  assert.equal(report.contracts.some((item) => item.id === "chronic-production-safety-evidence-v1" && item.path === "/api/chronic/production-safety-evidence"), true);
  assert.equal(report.contracts.some((item) => item.id === "chronic-interoperability-profiles-v1" && item.path === "/api/chronic/interoperability-profiles"), true);
  assert.equal(report.contracts.some((item) => item.id === "chronic-interoperability-validation-v1" && item.path === "/api/chronic/interoperability-validation"), true);
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
  assert.match(fs.readFileSync(written.markdown, "utf8"), /chronic-followup-escalation-v1/);
  assert.match(fs.readFileSync(written.markdown, "utf8"), /chronic-referral-continuity-v1/);
  assert.match(fs.readFileSync(written.markdown, "utf8"), /chronic-archive-standard-v1/);
  assert.match(fs.readFileSync(written.markdown, "utf8"), /chronic-pathway-quality-v1/);
  assert.match(fs.readFileSync(written.markdown, "utf8"), /chronic-pharmacy-insurance-closure-v1/);
  assert.match(fs.readFileSync(written.markdown, "utf8"), /chronic-production-safety-v1/);
  assert.match(fs.readFileSync(written.markdown, "utf8"), /chronic-production-safety-evidence-v1/);
  assert.match(fs.readFileSync(written.markdown, "utf8"), /chronic-interoperability-profiles-v1/);
  assert.match(fs.readFileSync(written.markdown, "utf8"), /chronic-interoperability-validation-v1/);
});
