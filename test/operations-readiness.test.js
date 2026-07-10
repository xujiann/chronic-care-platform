const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  applyProductionOperationsAction,
  buildOperationsReadinessReport,
  buildProductionOperationsCenter,
  parseArgs,
  renderMarkdown,
  seedDisasterRecoveryDrills,
  seedOperationsDutyShifts,
  seedOperationsIncidents,
  writeOutput
} = require("../scripts/operations-readiness");

const ROOT = path.resolve(__dirname, "..");

test("operations readiness validates production operation evidence", () => {
  const report = buildOperationsReadinessReport();
  assert.equal(report.ok, true);
  assert.equal(report.operationRoutes.every((item) => item.present && item.documented), true);
  assert.equal(report.externalDependencies.length, 6);
  assert.equal(report.productionTracks.length >= 4, true);
  assert.equal(report.runCenter.summary.serviceLevels, 4);
  assert.equal(report.runCenter.summary.productionReady, 0);
});

test("production operations center keeps duty incident and recovery gates explicit", () => {
  const center = buildProductionOperationsCenter({});
  assert.equal(center.ok, true);
  assert.equal(center.summary.dutyShifts, 3);
  assert.equal(center.summary.openIncidents, 3);
  assert.equal(center.summary.drills, 3);
  assert.equal(center.summary.productionReady, 0);
  assert.equal(center.blockers.length, 5);
});

test("production operations actions require notes and preserve production boundary", () => {
  assert.throws(
    () => applyProductionOperationsAction("incidents", seedOperationsIncidents()[0], { action: "acknowledge" }, { name: "tester", role: "commission" }),
    /requires note/
  );
  const incident = applyProductionOperationsAction("incidents", seedOperationsIncidents()[0], { action: "acknowledge", note: "demo alert acknowledged" }, { name: "tester", role: "commission" });
  assert.equal(incident.item.status, "acknowledged-demo");
  assert.equal(incident.item.productionReady, false);
  const duty = applyProductionOperationsAction("duty-shifts", seedOperationsDutyShifts()[0], { action: "record-handoff", note: "demo handoff checklist reviewed" }, { name: "tester", role: "commission" });
  assert.equal(duty.item.handoffStatus, "recorded-demo");
  assert.equal(duty.item.productionReady, false);
});

test("recovery rehearsal records RPO RTO digest without granting production approval", () => {
  const result = applyProductionOperationsAction("drills", seedDisasterRecoveryDrills()[0], { action: "rehearse-demo", note: "isolated sample restore rehearsal" }, { name: "tester", role: "commission" });
  assert.equal(result.item.status, "validated-demo");
  assert.equal(result.item.measuredRpoMinutes <= result.item.targetRpoMinutes, true);
  assert.equal(result.item.measuredRtoMinutes <= result.item.targetRtoMinutes, true);
  assert.equal(result.item.rehearsalDigest.length, 64);
  assert.equal(result.item.checks.some((item) => item.id === "rollback-owner-recorded" && !item.passed), true);
  assert.equal(result.item.productionReady, false);
  assert.equal(result.evidencePacket.productionEvidence, false);
});

test("operations readiness fails when an operation route is not documented", () => {
  const report = buildOperationsReadinessReport({
    readme: "",
    deployment: "",
    serverSource: fs.readFileSync(path.join(ROOT, "server.js"), "utf8")
  });
  assert.equal(report.ok, false);
  assert.equal(report.checks.some((item) => item.id === "operations:routes" && !item.passed), true);
});

test("operations readiness fails when external dependency risk markers are missing", () => {
  const serverSource = fs.readFileSync(path.join(ROOT, "server.js"), "utf8").replace(/identity-source/g, "identity_source_missing");
  const report = buildOperationsReadinessReport({ serverSource });
  assert.equal(report.ok, false);
  assert.equal(report.checks.some((item) => item.id === "operations:externalDependencies" && !item.passed), true);
});

test("operations readiness renders and writes release artifacts", (t) => {
  const outputDir = path.join(ROOT, "tmp", "operations-readiness-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const report = buildOperationsReadinessReport();
  const markdown = renderMarkdown(report);
  assert.match(markdown, /Operations readiness report/);
  assert.match(markdown, /External dependency risks/);
  assert.match(markdown, /Production operations run center/);
  assert.match(markdown, /Production boundary/);

  writeOutput(report, {
    output: path.join("tmp", "operations-readiness-test", "operations-readiness-report.json"),
    markdown: path.join("tmp", "operations-readiness-test", "operations-readiness-report.md")
  });

  const writtenJson = JSON.parse(fs.readFileSync(path.join(outputDir, "operations-readiness-report.json"), "utf8"));
  const writtenMarkdown = fs.readFileSync(path.join(outputDir, "operations-readiness-report.md"), "utf8");
  assert.equal(writtenJson.ok, true);
  assert.match(writtenMarkdown, /Production deployment tracks/);
});

test("operations readiness CLI parser keeps output flags", () => {
  const parsed = parseArgs(["--output=release/operations-readiness-report.json", "--markdown=release/operations-readiness-report.md"]);
  assert.equal(parsed.output, "release/operations-readiness-report.json");
  assert.equal(parsed.markdown, "release/operations-readiness-report.md");
});
