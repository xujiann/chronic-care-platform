const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  buildSpecialtyCutoverPack,
  buildEvidenceDossier,
  buildPilotBatchPlan,
  buildSiteEvidenceWorkflow,
  buildAcceptanceScenarioSuite,
  buildScenarioEvidenceMatrix,
  buildCutoverCommandCenter,
  buildObservationSignalBoard,
  buildRuntimeSmokePlan,
  normalizeTrack,
  renderMarkdown,
  selectFirstIncrement,
  writeCutoverPack
} = require("../emergency-specialty-cutover");

function report(overrides = {}) {
  return {
    ok: true,
    codeReady: true,
    productionReady: false,
    formalGoLiveState: "blocked-until-site-evidence-signed",
    summary: { checks: 10, passed: 10, sitePending: 2 },
    checks: [{ id: "demo", passed: true }],
    siteBlockers: [
      { id: "SITE-01", title: "external interface receipt", owner: "site owner", status: "site-pending" },
      { id: "SITE-02", title: "dual approval", owner: "commission", status: "site-pending" }
    ],
    ...overrides
  };
}

const tracks = [
  {
    id: "emergency-life-chain",
    name: "120急救生命链",
    department: "急救中心",
    page: "emergency.html",
    api: "/api/emergency/production-center",
    acceptanceIncrement: "single 120 station grey release",
    requiredExternalEvidence: ["dispatch receipt", "hospital handover"]
  },
  {
    id: "clinical-blood",
    name: "临床用血",
    department: "血液中心",
    page: "blood.html",
    api: "/api/blood-system/go-live",
    acceptanceIncrement: "single blood batch grey release",
    requiredExternalEvidence: ["cold chain receipt", "dual reviewer"]
  }
];

test("normalizeTrack keeps code readiness separate from formal production readiness", () => {
  const normalized = normalizeTrack(tracks[0], report());
  assert.equal(normalized.codeReady, true);
  assert.equal(normalized.productionReady, false);
  assert.equal(normalized.currentStage, "site-evidence");
  assert.equal(normalized.blockers.length, 2);
  assert.match(normalized.readiness.digest, /^sha256:[a-f0-9]{64}$/);
});

test("buildSpecialtyCutoverPack aggregates site blockers and cross-track controls", () => {
  const pack = buildSpecialtyCutoverPack({
    generatedAt: "2026-07-23T00:00:00.000Z",
    tracks,
    reports: {
      "emergency-life-chain": report(),
      "clinical-blood": report({ summary: { checks: 12, passed: 12, sitePending: 1 }, siteBlockers: [{ id: "BLOOD-01", title: "BIS receipt", owner: "blood center" }] })
    }
  });

  assert.equal(pack.summary.tracks, 2);
  assert.equal(pack.summary.codeReady, 2);
  assert.equal(pack.summary.productionReady, 0);
  assert.equal(pack.summary.siteBlockers, 3);
  assert.equal(pack.summary.totalChecks, 22);
  assert.equal(pack.summary.passedChecks, 22);
  assert.equal(pack.summary.formalGoLiveState, "blocked-until-site-evidence-signed");
  assert.equal(pack.crossTrackControls.length, 4);
  assert.ok(pack.crossTrackControls.some((item) => item.id === "four-eyes-site-evidence"));
  assert.equal(pack.rehearsalPlan.scope.primaryTrackId, "emergency-life-chain");
  assert.equal(pack.rehearsalPlan.timeline.length, 3);
  assert.ok(pack.rehearsalPlan.rollbackTriggers.length >= 4);
  assert.ok(pack.rehearsalPlan.dutyRoster.some((item) => item.role === "安全审计"));
  assert.equal(pack.goNoGoDecision.currentDecision, "no-go-site-evidence-pending");
  assert.equal(pack.goNoGoDecision.score, 20);
  assert.equal(pack.goNoGoDecision.threshold, 100);
  assert.equal(pack.goNoGoDecision.scorecard.length, 5);
  assert.ok(pack.goNoGoDecision.hardStops.some((item) => item.id === "patient-safety"));
  assert.equal(pack.evidenceDossier.status, "site-evidence-pending");
  assert.equal(pack.evidenceDossier.totalEntries, 3);
  assert.ok(pack.evidenceDossier.hardStopOpen >= 2);
  assert.ok(pack.evidenceDossier.firstIncrementRequired.includes("emergency-life-chain:SITE-01"));
  assert.ok(pack.evidenceDossier.entries.some((item) => item.verificationChecks.includes("external-interface-receipt-matched")));
  assert.equal(pack.evidenceDossier.reviewPolicy.submitterMustDifferFromReviewer, true);
  assert.equal(pack.pilotBatchPlan.status, "ready-to-plan-controlled-rehearsal");
  assert.equal(pack.pilotBatchPlan.batches.length, 3);
  assert.equal(pack.pilotBatchPlan.batches[0].id, "batch-0-preflight");
  assert.equal(pack.pilotBatchPlan.batches[1].id, "batch-1-single-chain");
  assert.equal(pack.siteEvidenceWorkflow.currentGate, "submitted-or-accepted-site-evidence-required-before-batch-1");
  assert.equal(pack.siteEvidenceWorkflow.states.length, 6);
  assert.ok(pack.siteEvidenceWorkflow.transitions.some((item) => item.action === "accept-evidence"));
  assert.ok(pack.siteEvidenceWorkflow.batchOneEntryRequires.evidenceIds.includes("emergency-life-chain:SITE-01"));
  assert.ok(pack.siteEvidenceWorkflow.auditEvents.every((item) => item.appendOnly));
  assert.equal(pack.acceptanceScenarioSuite.status, "ready-for-controlled-rehearsal-only");
  assert.equal(pack.acceptanceScenarioSuite.summary.scenarios, 5);
  assert.equal(pack.acceptanceScenarioSuite.summary.hardStopScenarios, 4);
  assert.ok(pack.acceptanceScenarioSuite.scenarios.some((item) => item.id === "scenario-3-signature-rejection"));
  assert.ok(pack.acceptanceScenarioSuite.scenarios.every((item) => item.batchId === "batch-1-single-chain"));
  assert.equal(pack.scenarioEvidenceMatrix.status, "not-run");
  assert.equal(pack.scenarioEvidenceMatrix.summary.scenarios, 5);
  assert.equal(pack.scenarioEvidenceMatrix.summary.evidenceLinks, 10);
  assert.ok(pack.scenarioEvidenceMatrix.rows.some((item) => item.scenarioId === "scenario-5-evidence-replay" && item.goNoGoImpact === "review-scorecard-after-replay"));
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
  assert.match(pack.integrity.digest, /^sha256:[a-f0-9]{64}$/);
});

test("selectFirstIncrement prioritizes emergency life chain when code is ready but site evidence is pending", () => {
  const pack = buildSpecialtyCutoverPack({
    tracks,
    reports: {
      "emergency-life-chain": report(),
      "clinical-blood": report()
    }
  });

  assert.equal(pack.firstIncrement.trackId, "emergency-life-chain");
  assert.match(pack.firstIncrement.why, /现场证据/);
  assert.equal(pack.firstIncrement.requiredBeforeStart.length, 2);
});

test("renderMarkdown exposes the digest, departments, blockers and first grey increment", () => {
  const pack = buildSpecialtyCutoverPack({
    tracks,
    reports: {
      "emergency-life-chain": report(),
      "clinical-blood": report()
    }
  });
  const markdown = renderMarkdown(pack);
  assert.match(markdown, /T10 急救、用血、影像与体检专项上线割接包/);
  assert.match(markdown, /120急救生命链/);
  assert.match(markdown, /临床用血/);
  assert.match(markdown, /Site blockers: 4/);
  assert.match(markdown, /sha256:[a-f0-9]{64}/);
  assert.match(markdown, /首个可验收灰度增量/);
  assert.match(markdown, /灰度演练计划/);
  assert.match(markdown, /T-1 preflight/);
  assert.match(markdown, /回退触发/);
  assert.match(markdown, /Go\/No-Go 决策矩阵/);
  assert.match(markdown, /no-go-site-evidence-pending/);
  assert.match(markdown, /Hard stops/);
  assert.match(markdown, /Site evidence dossier/);
  assert.match(markdown, /Controlled pilot batch plan/);
  assert.match(markdown, /batch-1-single-chain/);
  assert.match(markdown, /external-interface-receipt-matched|SITE-01/);
  assert.match(markdown, /Site evidence workflow/);
  assert.match(markdown, /submit-evidence/);
  assert.match(markdown, /accept-evidence/);
  assert.match(markdown, /Acceptance scenario suite/);
  assert.match(markdown, /scenario-1-normal-chain/);
  assert.match(markdown, /scenario-4-manual-downgrade/);
  assert.match(markdown, /Scenario evidence matrix/);
  assert.match(markdown, /keep-no-go-on-failure/);
  assert.match(markdown, /review-scorecard-after-replay/);
  assert.match(markdown, /Cutover command center/);
  assert.match(markdown, /window-t0-controlled-rehearsal/);
  assert.match(markdown, /release-commander/);
  assert.match(markdown, /Observation signal board/);
  assert.match(markdown, /lane-patient-safety/);
  assert.match(markdown, /open-watch-only-batch-2/);
  assert.match(markdown, /Runtime smoke plan/);
  assert.match(markdown, /smoke-release-gates/);
  assert.match(markdown, /controlled-rehearsal-only/);
});

test("buildEvidenceDossier maps blockers to reviewable evidence and hard-stop policy", () => {
  const normalized = tracks.map((track) => normalizeTrack(track, report()));
  const dossier = buildEvidenceDossier(normalized, {
    trackId: "emergency-life-chain",
    requiredBeforeStart: ["SITE-01", "SITE-02"]
  });

  assert.equal(dossier.status, "site-evidence-pending");
  assert.equal(dossier.totalEntries, 4);
  assert.ok(dossier.hardStopOpen >= 2);
  assert.equal(dossier.reviewPolicy.digestAlgorithm, "sha256");
  assert.ok(dossier.entries.every((item) => item.requiredArtifacts.includes("sha256-digest-and-timestamp")));
  assert.ok(dossier.entries.some((item) => item.requiredForFirstIncrement));
});

test("buildPilotBatchPlan keeps production expansion behind preflight and T+1 observation", () => {
  const normalized = tracks.map((track) => normalizeTrack(track, report()));
  const plan = buildPilotBatchPlan(normalized, {
    trackId: "emergency-life-chain",
    requiredBeforeStart: ["SITE-01", "SITE-02"]
  });

  assert.equal(plan.batches.length, 3);
  assert.equal(plan.batches[0].promotionDecision, "allow batch-1 rehearsal only");
  assert.match(plan.batches[1].promotionDecision, /T\+1 observation/);
  assert.match(plan.batches[2].promotionDecision, /risk and evidence completeness/);
});

test("buildSiteEvidenceWorkflow defines evidence closure states, transitions and batch-1 gate", () => {
  const normalized = tracks.map((track) => normalizeTrack(track, report()));
  const firstIncrement = {
    trackId: "emergency-life-chain",
    requiredBeforeStart: ["SITE-01", "SITE-02"]
  };
  const dossier = buildEvidenceDossier(normalized, firstIncrement);
  const plan = buildPilotBatchPlan(normalized, firstIncrement);
  const workflow = buildSiteEvidenceWorkflow(dossier, plan);

  assert.equal(workflow.states.length, 6);
  assert.ok(workflow.states.some((item) => item.id === "expired" && item.terminal));
  assert.ok(workflow.transitions.some((item) => item.from === "under-review" && item.to === "accepted"));
  assert.ok(workflow.transitions.some((item) => item.requiredChecks.includes("submitter-reviewer-separation")));
  assert.equal(workflow.batchOneEntryRequires.minimumStatus, "submitted");
  assert.ok(workflow.batchOneEntryRequires.evidenceIds.every((id) => id.startsWith("emergency-life-chain:")));
  assert.ok(workflow.gateRules.some((item) => /No-Go/.test(item)));
});

test("buildAcceptanceScenarioSuite turns the first increment into executable acceptance scripts", () => {
  const normalized = tracks.map((track) => normalizeTrack(track, report()));
  const firstIncrement = {
    trackId: "emergency-life-chain",
    requiredBeforeStart: ["SITE-01", "SITE-02"]
  };
  const dossier = buildEvidenceDossier(normalized, firstIncrement);
  const plan = buildPilotBatchPlan(normalized, firstIncrement);
  const workflow = buildSiteEvidenceWorkflow(dossier, plan);
  const suite = buildAcceptanceScenarioSuite(normalized, firstIncrement, dossier, workflow);

  assert.equal(suite.status, "ready-for-controlled-rehearsal-only");
  assert.equal(suite.primaryTrackId, "emergency-life-chain");
  assert.equal(suite.summary.scenarios, 5);
  assert.equal(suite.summary.hardStopScenarios, 4);
  assert.ok(suite.requiredEvidenceIds.includes("emergency-life-chain:SITE-01"));
  assert.ok(suite.scenarios.some((item) => item.type === "security-negative" && item.hardStopOnFail));
  assert.ok(suite.scenarios.some((item) => item.type === "audit-replay" && !item.hardStopOnFail));
  assert.ok(suite.executionRules.some((item) => /No-Go/.test(item)));
});

test("buildScenarioEvidenceMatrix links scenarios to evidence, workflow events and decision impact", () => {
  const normalized = tracks.map((track) => normalizeTrack(track, report()));
  const firstIncrement = {
    trackId: "emergency-life-chain",
    requiredBeforeStart: ["SITE-01", "SITE-02"]
  };
  const dossier = buildEvidenceDossier(normalized, firstIncrement);
  const plan = buildPilotBatchPlan(normalized, firstIncrement);
  const workflow = buildSiteEvidenceWorkflow(dossier, plan);
  const suite = buildAcceptanceScenarioSuite(normalized, firstIncrement, dossier, workflow);
  const matrix = buildScenarioEvidenceMatrix(suite, dossier, workflow);

  assert.equal(matrix.status, "not-run");
  assert.equal(matrix.summary.scenarios, 5);
  assert.equal(matrix.summary.evidenceLinks, 10);
  assert.equal(matrix.summary.hardStopRows, 4);
  assert.ok(matrix.rows.every((row) => row.batchId === "batch-1-single-chain"));
  assert.ok(matrix.rows.some((row) => row.requiredWorkflowEvents.includes("site-evidence.accept-evidence")));
  assert.ok(matrix.decisionRules.some((item) => /Go\/No-Go/.test(item)));
});

test("buildCutoverCommandCenter binds windows, duty seats and escalation to batch-1 gates", () => {
  const normalized = tracks.map((track) => normalizeTrack(track, report()));
  const firstIncrement = {
    trackId: "emergency-life-chain",
    requiredBeforeStart: ["SITE-01", "SITE-02"]
  };
  const dossier = buildEvidenceDossier(normalized, firstIncrement);
  const plan = buildPilotBatchPlan(normalized, firstIncrement);
  const workflow = buildSiteEvidenceWorkflow(dossier, plan);
  const suite = buildAcceptanceScenarioSuite(normalized, firstIncrement, dossier, workflow);
  const matrix = buildScenarioEvidenceMatrix(suite, dossier, workflow);
  const commandCenter = buildCutoverCommandCenter(normalized, firstIncrement, plan, workflow, matrix);

  assert.equal(commandCenter.status, "command-center-ready-for-rehearsal");
  assert.equal(commandCenter.summary.windows, 3);
  assert.equal(commandCenter.summary.watchOnlyTracks, 1);
  assert.ok(commandCenter.windows.some((item) => item.id === "window-t-1-freeze" && item.requiredInputs.includes("emergency-life-chain:SITE-01")));
  assert.ok(commandCenter.windows.some((item) => item.id === "window-t0-controlled-rehearsal" && item.requiredInputs.includes("scenario-3-signature-rejection")));
  assert.ok(commandCenter.escalationRules.some((item) => /manual downgrade/.test(item)));
  assert.ok(commandCenter.decisionArtifacts.includes("t-plus-1-observation-memo"));
});

test("buildObservationSignalBoard turns T+1 observation into lane-level No-Go signals", () => {
  const normalized = tracks.map((track) => normalizeTrack(track, report()));
  const firstIncrement = {
    trackId: "emergency-life-chain",
    requiredBeforeStart: ["SITE-01", "SITE-02"]
  };
  const dossier = buildEvidenceDossier(normalized, firstIncrement);
  const plan = buildPilotBatchPlan(normalized, firstIncrement);
  const workflow = buildSiteEvidenceWorkflow(dossier, plan);
  const suite = buildAcceptanceScenarioSuite(normalized, firstIncrement, dossier, workflow);
  const matrix = buildScenarioEvidenceMatrix(suite, dossier, workflow);
  const commandCenter = buildCutoverCommandCenter(normalized, firstIncrement, plan, workflow, matrix);
  const board = buildObservationSignalBoard(normalized, firstIncrement, commandCenter, matrix);

  assert.equal(board.status, "observation-ready");
  assert.equal(board.summary.lanes, 4);
  assert.ok(board.summary.p0Signals >= 5);
  assert.equal(board.summary.commandSeatsReady, 4);
  assert.ok(board.lanes.every((lane) => lane.commandSeatReady));
  assert.ok(board.lanes.some((lane) => lane.id === "lane-interface-reliability" && lane.signals.some((signal) => signal.id === "duplicate-mutation")));
  assert.ok(board.decisionOutcomes.some((item) => item.id === "repeat-batch-1"));
  assert.ok(board.requiredArtifacts.includes("audit-replay-and-digest-review"));
});

test("buildRuntimeSmokePlan defines the final code-side launch smoke gates", () => {
  const normalized = tracks.map((track) => normalizeTrack(track, report()));
  const firstIncrement = {
    trackId: "emergency-life-chain",
    requiredBeforeStart: ["SITE-01", "SITE-02"]
  };
  const dossier = buildEvidenceDossier(normalized, firstIncrement);
  const plan = buildPilotBatchPlan(normalized, firstIncrement);
  const workflow = buildSiteEvidenceWorkflow(dossier, plan);
  const suite = buildAcceptanceScenarioSuite(normalized, firstIncrement, dossier, workflow);
  const matrix = buildScenarioEvidenceMatrix(suite, dossier, workflow);
  const commandCenter = buildCutoverCommandCenter(normalized, firstIncrement, plan, workflow, matrix);
  const board = buildObservationSignalBoard(normalized, firstIncrement, commandCenter, matrix);
  const smoke = buildRuntimeSmokePlan(normalized, firstIncrement, board);

  assert.equal(smoke.status, "ready-for-runtime-smoke");
  assert.equal(smoke.launchMode, "controlled-rehearsal-only");
  assert.equal(smoke.summary.suites, 5);
  assert.equal(smoke.summary.automatedSuites, 4);
  assert.equal(smoke.summary.manualSuites, 1);
  assert.ok(smoke.trackRoutes.some((route) => route.trackId === "emergency-life-chain" && route.expectedState === "controlled-rehearsal-only"));
  assert.ok(smoke.suites.some((item) => item.id === "smoke-release-gates" && /deploy:check/.test(item.command)));
  assert.ok(smoke.suites.some((item) => item.id === "smoke-observation-artifacts" && item.checks.includes("t-plus-1-observation-memo")));
  assert.ok(smoke.hardStops.some((item) => /server API smoke/.test(item)));
});

test("writeCutoverPack writes JSON and Markdown artifacts without touching runtime data", () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "t10-cutover-"));
  const pack = buildSpecialtyCutoverPack({
    tracks,
    reports: {
      "emergency-life-chain": report(),
      "clinical-blood": report()
    }
  });

  const output = writeCutoverPack(pack, { outputDir });
  assert.equal(JSON.parse(fs.readFileSync(output.jsonPath, "utf8")).module, "t10-emergency-blood-imaging-physical-exam-cutover");
  assert.match(fs.readFileSync(output.markdownPath, "utf8"), /T10 急救、用血、影像与体检专项上线割接包/);
});

test("static cutover preview page exposes T10 tracks and release-artifact fallback", () => {
  const root = path.resolve(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "t10-specialty-cutover.html"), "utf8");
  const client = fs.readFileSync(path.join(root, "t10-specialty-cutover.js"), "utf8");

  assert.match(html, /T10专项上线割接总控/);
  assert.match(html, /灰度演练、回退与值守计划/);
  assert.match(html, /Go\/No-Go 决策矩阵/);
  assert.match(html, /现场证据包与硬阻断收口/);
  assert.match(html, /受控灰度批次推进计划/);
  assert.match(html, /现场证据闭环状态机/);
  assert.match(html, /首增量验收场景脚本/);
  assert.match(html, /场景-证据判定矩阵/);
  assert.match(html, /切换指挥台与值守责任/);
  assert.match(html, /observation-signal-board/);
  assert.match(html, /runtime-smoke-plan/);
  assert.match(html, /t10-specialty-cutover\.js\?v=runtime-smoke-plan/);
  assert.match(html, /emergency\.html/);
  assert.match(html, /blood\.html/);
  assert.match(html, /imaging-cloud\.html/);
  assert.match(html, /physical-examination\.html/);
  assert.match(client, /release\/t10-specialty-cutover-pack\.json/);
  assert.match(client, /fallbackCutoverPack/);
  assert.match(client, /withCutoverDefaults/);
  assert.match(client, /renderRehearsalPlan/);
  assert.match(client, /renderDecisionMatrix/);
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
  assert.match(client, /Accepted and digest-locked/);
  assert.match(client, /scenario-3-signature-rejection/);
  assert.match(client, /ready-for-controlled-rehearsal-only/);
  assert.match(client, /keep-no-go-on-failure/);
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
  assert.match(client, /120急救生命链/);
  assert.match(client, /四眼现场证据签收/);
  assert.match(client, /T\+1 observation/);
  assert.match(client, /no-go-site-evidence-pending/);
  assert.match(client, /患者安全/);
  assert.match(client, /blocked-until-site-evidence-signed/);
});
