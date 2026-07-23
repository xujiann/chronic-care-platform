"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { buildSpecialtyCutoverPack } = require("../emergency-specialty-cutover");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

test("T00 exposes the T10 specialty cutover pack through public integration contracts", () => {
  const server = read("server.js");
  const client = read("t10-specialty-cutover.js");
  const workbench = read("workbench.html");
  const readme = read("README.md");
  const releaseReport = read("scripts/release-report.js");
  const pkg = JSON.parse(read("package.json"));

  assert.match(server, /buildSpecialtyCutoverPack/);
  assert.match(server, /url\.pathname === "\/api\/t10-specialty\/cutover-pack"/);
  assert.match(server, /url\.pathname === "\/api\/t10-specialty-cutover"/);
  assert.match(server, /requireApiRole\(req, res, \["commission"\], url\.pathname\)/);
  assert.match(server, /t10-specialty-cutover-read/);
  assert.match(client, /HealthCityAuth\?\.authFetch/);
  assert.match(client, /HealthCityAuth\?\.authFetch \|\| fetch/);
  assert.match(client, /\/api\/t10-specialty\/cutover-pack/);
  assert.match(client, /release\/t10-specialty-cutover-pack\.json/);
  assert.match(client, /source === "server-api"/);
  assert.match(client, /withCutoverDefaults/);
  assert.match(client, /renderEvidenceDossier/);
  assert.match(client, /renderPilotBatchPlan/);
  assert.match(client, /renderSiteEvidenceWorkflow/);
  assert.match(client, /renderAcceptanceScenarioSuite/);
  assert.match(client, /renderScenarioEvidenceMatrix/);
  assert.match(client, /renderCutoverCommandCenter/);
  assert.match(client, /renderObservationSignalBoard/);
  assert.match(client, /renderRuntimeSmokePlan/);
  assert.match(client, /evidence-id-present/);
  assert.match(client, /batch-1-single-chain/);
  assert.match(client, /submit-evidence/);
  assert.match(client, /scenario-3-signature-rejection/);
  assert.match(client, /review-scorecard-after-replay/);
  assert.match(client, /command-center-ready-for-rehearsal/);
  assert.match(client, /window-t0-controlled-rehearsal/);
  assert.match(client, /release-commander/);
  assert.match(client, /observation-ready/);
  assert.match(client, /lane-interface-reliability/);
  assert.match(client, /open-watch-only-batch-2/);
  assert.match(client, /ready-for-runtime-smoke/);
  assert.match(client, /smoke-server-api/);
  assert.match(client, /smoke-release-gates/);
  assert.match(readme, /t10-specialty-cutover\.html/);
  assert.match(readme, /GET \/api\/t10-specialty\/cutover-pack/);
  assert.match(workbench, /t10-specialty-cutover\.html/);
  assert.match(workbench, /T10割接总控/);
  assert.equal(pkg.scripts["t10:specialty-cutover"], "node emergency-specialty-cutover.js");
  assert.match(releaseReport, /specialtyCutoverChecks/);
  assert.match(releaseReport, /specialtyCutover:rehearsalPlan/);
  assert.match(releaseReport, /specialtyCutover:goNoGoDecision/);
  assert.match(releaseReport, /specialtyCutover:evidenceDossier/);
  assert.match(releaseReport, /specialtyCutover:pilotBatchPlan/);
  assert.match(releaseReport, /specialtyCutover:siteEvidenceWorkflow/);
  assert.match(releaseReport, /specialtyCutover:acceptanceScenarioSuite/);
  assert.match(releaseReport, /specialtyCutover:scenarioEvidenceMatrix/);
  assert.match(releaseReport, /specialtyCutover:cutoverCommandCenter/);
  assert.match(releaseReport, /specialtyCutover:observationSignalBoard/);
  assert.match(releaseReport, /specialtyCutover:runtimeSmokePlan/);
  assert.match(releaseReport, /t10-specialty-cutover-pack\.json/);
  assert.match(releaseReport, /t10-specialty-cutover-pack\.md/);
});

test("T10 public projection keeps all real production gates closed with rehearsal and go/no-go controls", () => {
  const pack = buildSpecialtyCutoverPack({ generatedAt: "2026-07-23T00:00:00.000Z" });

  assert.equal(pack.summary.tracks, 4);
  assert.equal(pack.summary.codeReady, 4);
  assert.equal(pack.summary.productionReady, 0);
  assert.equal(pack.summary.formalGoLiveState, "blocked-until-site-evidence-signed");
  assert.ok(pack.summary.siteBlockers > 0);
  assert.ok(pack.tracks.every((track) => track.productionReady === false && track.blockers.length > 0));
  assert.deepEqual(pack.stages, [
    "code-readiness",
    "synthetic-acceptance",
    "joint-test",
    "site-evidence",
    "go-no-go",
    "grey-release"
  ]);
  assert.equal(pack.rehearsalPlan.scope.primaryTrackId, "emergency-life-chain");
  assert.equal(pack.rehearsalPlan.timeline.length, 3);
  assert.equal(pack.goNoGoDecision.currentDecision, "no-go-site-evidence-pending");
  assert.equal(pack.goNoGoDecision.score, 20);
  assert.equal(pack.goNoGoDecision.threshold, 100);
  assert.ok(pack.goNoGoDecision.hardStops.some((item) => item.id === "patient-safety"));
  assert.equal(pack.evidenceDossier.status, "site-evidence-pending");
  assert.equal(pack.evidenceDossier.totalEntries, pack.summary.siteBlockers);
  assert.ok(pack.evidenceDossier.hardStopOpen > 0);
  assert.ok(pack.evidenceDossier.firstIncrementRequired.every((id) => id.startsWith("emergency-life-chain:")));
  assert.equal(pack.pilotBatchPlan.status, "ready-to-plan-controlled-rehearsal");
  assert.equal(pack.pilotBatchPlan.batches.length, 3);
  assert.equal(pack.siteEvidenceWorkflow.currentGate, "submitted-or-accepted-site-evidence-required-before-batch-1");
  assert.equal(pack.siteEvidenceWorkflow.states.length, 6);
  assert.ok(pack.siteEvidenceWorkflow.transitions.some((item) => item.action === "accept-evidence"));
  assert.equal(pack.siteEvidenceWorkflow.batchOneEntryRequires.minimumStatus, "submitted");
  assert.equal(pack.acceptanceScenarioSuite.status, "ready-for-controlled-rehearsal-only");
  assert.equal(pack.acceptanceScenarioSuite.summary.scenarios, 5);
  assert.equal(pack.acceptanceScenarioSuite.summary.hardStopScenarios, 4);
  assert.ok(pack.acceptanceScenarioSuite.scenarios.some((item) => item.id === "scenario-4-manual-downgrade"));
  assert.equal(pack.scenarioEvidenceMatrix.status, "not-run");
  assert.equal(pack.scenarioEvidenceMatrix.summary.evidenceLinks, pack.scenarioEvidenceMatrix.rows.reduce((sum, row) => sum + row.evidence.length, 0));
  assert.ok(pack.scenarioEvidenceMatrix.summary.evidenceLinks >= 10);
  assert.ok(pack.scenarioEvidenceMatrix.rows.some((item) => item.goNoGoImpact === "keep-no-go-on-failure"));
  assert.equal(pack.cutoverCommandCenter.status, "command-center-ready-for-rehearsal");
  assert.equal(pack.cutoverCommandCenter.summary.windows, 3);
  assert.equal(pack.cutoverCommandCenter.summary.rosterSeats, 5);
  assert.ok(pack.cutoverCommandCenter.windows.some((item) => item.id === "window-t0-controlled-rehearsal"));
  assert.ok(pack.cutoverCommandCenter.roster.some((item) => item.seat === "release-commander"));
  assert.equal(pack.observationSignalBoard.status, "observation-ready");
  assert.equal(pack.observationSignalBoard.summary.lanes, 4);
  assert.equal(pack.observationSignalBoard.summary.commandSeatsReady, 4);
  assert.ok(pack.observationSignalBoard.lanes.some((item) => item.id === "lane-evidence-audit" && item.linkedScenarios.includes("scenario-5-evidence-replay")));
  assert.equal(pack.runtimeSmokePlan.status, "ready-for-runtime-smoke");
  assert.equal(pack.runtimeSmokePlan.launchMode, "controlled-rehearsal-only");
  assert.equal(pack.runtimeSmokePlan.summary.suites, 5);
  assert.ok(pack.runtimeSmokePlan.suites.some((item) => item.id === "smoke-server-api"));
});
