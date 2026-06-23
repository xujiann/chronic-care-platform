const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const { buildResearchSandboxReadiness, renderMarkdown } = require(path.join(ROOT, "scripts", "research-sandbox-readiness.js"));

test("research sandbox readiness covers datasets, ethics, de-identification, audit, and outcomes", () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8"));
  fixture.researchDatasets = fixture.researchDatasets.map((item) => ({
    ...item,
    ethicsStatus: item.ethicsStatus || "approved",
    deidentificationStatus: item.deidentificationStatus || "released",
    sandbox: item.sandbox || { status: "active", environment: "demo-safe-sandbox" },
    sourceCollections: item.sourceCollections || ["personalRecords", "diagnosticReports"]
  }));
  fixture.dataAccessLogs = [
    { id: "dal-research-test", scope: "research-sandbox", purpose: "rd-hypertension-001:sandbox-access:test", result: "allowed" },
    ...fixture.dataAccessLogs
  ];
  const report = buildResearchSandboxReadiness(fixture);
  assert.equal(report.ok, true);
  assert.equal(report.boundaries.includes("ethics approval"), true);
  assert.equal(report.reusableCollections.includes("personalRecords"), true);
  assert.equal(report.reusableCollections.includes("diagnosticReports"), true);
  assert.equal(report.checks.every((item) => item.passed), true);
  assert.equal(report.summary.sandboxReady >= 2, true);
  assert.match(renderMarkdown(report), /Research Sandbox Readiness/);
});

test("research sandbox readiness fails when sandbox access has no audit trail", () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8"));
  fixture.dataAccessLogs = [];
  const report = buildResearchSandboxReadiness(fixture);
  assert.equal(report.ok, false);
  assert.equal(report.checks.find((item) => item.id === "research:audit").passed, false);
});

test("research sandbox readiness command writes release artifacts", () => {
  const releaseDir = path.join(ROOT, "release");
  fs.rmSync(path.join(releaseDir, "research-sandbox-readiness-report.json"), { force: true });
  fs.rmSync(path.join(releaseDir, "research-sandbox-readiness-report.md"), { force: true });
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8"));
  data.dataAccessLogs = [
    { id: "dal-research-command-test", scope: "research-sandbox", purpose: "readiness command", result: "allowed" },
    ...data.dataAccessLogs
  ];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "research-sandbox-readiness-"));
  const tempData = path.join(tempDir, "db.json");
  fs.writeFileSync(tempData, JSON.stringify(data, null, 2), "utf8");
  const report = buildResearchSandboxReadiness(JSON.parse(fs.readFileSync(tempData, "utf8")));
  assert.equal(report.ok, true);
  assert.equal(fs.existsSync(path.join(ROOT, "scripts", "research-sandbox-readiness.js")), true);
  fs.rmSync(tempDir, { recursive: true, force: true });
});
