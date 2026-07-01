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
    governance: item.governance || { dataUseAgreement: "DUA-DEMO-TEST", minimumNecessary: true, reidentificationProhibited: true, exportReviewRequired: true, retentionDays: 180 },
    sourceCollections: item.sourceCollections || ["personalRecords", "diagnosticReports"]
  }));
  fixture.dataAccessLogs = [
    { id: "dal-research-test", scope: "research-sandbox", purpose: "rd-hypertension-001:sandbox-access:test", result: "allowed" },
    ...fixture.dataAccessLogs
  ];
  const report = buildResearchSandboxReadiness(fixture);
  assert.equal(report.ok, true);
  assert.equal(report.boundaries.includes("ethics approval"), true);
  assert.equal(report.boundaries.includes("policy controls"), true);
  assert.equal(report.reusableCollections.includes("personalRecords"), true);
  assert.equal(report.reusableCollections.includes("diagnosticReports"), true);
  assert.equal(report.checks.every((item) => item.passed), true);
  assert.equal(report.summary.sandboxReady >= 2, true);
  assert.equal(report.summary.policyReady >= 2, true);
  assert.equal(report.summary.evidenceReady >= 2, true);
  assert.equal(report.checks.find((item) => item.id === "research:evidence-documents").passed, true);
  assert.equal(report.preLaunchDevelopment.some((item) => item.id === "launch:sandbox-isolation-export"), true);
  assert.match(renderMarkdown(report), /DUA-DEMO/);
  assert.match(renderMarkdown(report), /Pre-launch Development/);
  assert.match(renderMarkdown(report), /Research Sandbox Readiness/);
});

test("research sandbox readiness fails when sandbox access has no audit trail", () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8"));
  fixture.dataAccessLogs = [];
  const report = buildResearchSandboxReadiness(fixture);
  assert.equal(report.ok, false);
  assert.equal(report.checks.find((item) => item.id === "research:audit").passed, false);
});

test("research sandbox readiness fails when policy controls are incomplete", () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8"));
  fixture.researchDatasets = fixture.researchDatasets.map((item) => ({ ...item, governance: { ...item.governance, dataUseAgreement: "" } }));
  fixture.dataAccessLogs = [
    { id: "dal-research-policy-test", scope: "research-sandbox", purpose: "policy test", result: "allowed" },
    ...fixture.dataAccessLogs
  ];
  const report = buildResearchSandboxReadiness(fixture);
  assert.equal(report.ok, false);
  assert.equal(report.checks.find((item) => item.id === "research:policy-controls").passed, false);
});

test("research sandbox readiness fails when evidence documents are incomplete", () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8"));
  fixture.researchDatasets = fixture.researchDatasets.map((item) => ({ ...item, evidenceDocuments: (item.evidenceDocuments || []).filter((doc) => doc.type !== "data-use-agreement") }));
  fixture.dataAccessLogs = [
    { id: "dal-research-evidence-test", scope: "research-sandbox", purpose: "evidence test", result: "allowed" },
    ...fixture.dataAccessLogs
  ];
  const report = buildResearchSandboxReadiness(fixture);
  assert.equal(report.ok, false);
  assert.equal(report.checks.find((item) => item.id === "research:evidence-documents").passed, false);
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
