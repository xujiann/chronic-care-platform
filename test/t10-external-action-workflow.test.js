const assert = require("node:assert/strict");
const test = require("node:test");

const { buildSpecialtyPlanReview } = require("../t10-specialty-plan-review");
const {
  ACCEPT_CONFIRMATION,
  createExternalActionBoard,
  applyExternalActionCommand,
  evaluateExternalActionGate,
  buildExternalActionWorkflowPlan,
  verifyExternalActionBoard
} = require("../t10-external-action-workflow");

const GENERATED_AT = "2026-07-29T00:00:00.000Z";
const DIGEST = `sha256:${"b".repeat(64)}`;

function review(trackIds = ["emergency-life-chain"]) {
  return buildSpecialtyPlanReview({ selectedTrackIds: trackIds, generatedAt: GENERATED_AT });
}

function submitEvidence(board, actionId, submitterId = "owner-a") {
  let next = applyExternalActionCommand(board, actionId, {
    action: "assign",
    actorId: "project-office",
    assigneeId: submitterId,
    occurredAt: "2026-07-29T01:00:00.000Z"
  });
  next = applyExternalActionCommand(next, actionId, {
    action: "submit-evidence",
    actorId: submitterId,
    evidenceRef: `${actionId}-receipt`,
    originalReference: `evidence://${actionId}/original`,
    interfaceVersion: "1.0.0",
    evidenceDigest: DIGEST,
    occurredAt: "2026-07-29T02:00:00.000Z"
  });
  return next;
}

function acceptEvidence(board, actionId, reviewerId = "reviewer-b") {
  let next = applyExternalActionCommand(board, actionId, {
    action: "start-review",
    actorId: reviewerId,
    occurredAt: "2026-07-29T03:00:00.000Z"
  });
  next = applyExternalActionCommand(next, actionId, {
    action: "accept",
    actorId: reviewerId,
    confirmation: ACCEPT_CONFIRMATION,
    evidenceDigest: DIGEST,
    verificationRef: `${actionId}-independent-verification`,
    occurredAt: "2026-07-29T04:00:00.000Z"
  });
  return next;
}

test("external action board creates priority deadlines and preserves the production boundary", () => {
  const board = createExternalActionBoard(review(), { generatedAt: GENERATED_AT });
  assert.equal(board.actions.length, 3);
  assert.equal(board.summary.p0Open, 2);
  assert.equal(board.actions.find((item) => item.priority === "P0").deadlineAt, "2026-08-05T00:00:00.000Z");
  assert.equal(board.actions.find((item) => item.priority === "P1").deadlineAt, "2026-08-19T00:00:00.000Z");
  assert.match(board.integrity.digest, /^sha256:[a-f0-9]{64}$/);
  assert.match(board.formalBoundary, /never set productionReady/);
  assert.equal(verifyExternalActionBoard(board).ok, true);
});

test("assign, submit, independent review and acceptance form a digest-chained workflow", () => {
  const actionId = "EMG-NEXT-01";
  let board = submitEvidence(createExternalActionBoard(review()), actionId);
  assert.equal(board.actions.find((item) => item.id === actionId).status, "evidence-submitted");
  assert.throws(() => applyExternalActionCommand(board, actionId, {
    action: "start-review",
    actorId: "owner-a"
  }), /reviewer must differ/);
  board = acceptEvidence(board, actionId);
  const row = board.actions.find((item) => item.id === actionId);
  assert.equal(row.status, "accepted");
  assert.equal(row.review.reviewerId, "reviewer-b");
  assert.equal(board.audit.length, 4);
  assert.equal(board.audit[0].previousDigest, "GENESIS");
  assert.equal(board.audit[1].previousDigest, board.audit[0].digest);
  assert.equal(verifyExternalActionBoard(board).ok, true);
});

test("returned evidence requires a new revision before it can be accepted", () => {
  const actionId = "EMG-NEXT-01";
  let board = submitEvidence(createExternalActionBoard(review()), actionId);
  board = applyExternalActionCommand(board, actionId, {
    action: "start-review",
    actorId: "reviewer-b",
    occurredAt: "2026-07-29T03:00:00.000Z"
  });
  board = applyExternalActionCommand(board, actionId, {
    action: "return",
    actorId: "reviewer-b",
    reason: "interface version does not match the original receipt",
    occurredAt: "2026-07-29T04:00:00.000Z"
  });
  assert.equal(board.actions.find((item) => item.id === actionId).revision, 2);
  board = applyExternalActionCommand(board, actionId, {
    action: "resubmit-evidence",
    actorId: "owner-a",
    evidenceRef: "replacement-receipt",
    originalReference: "evidence://replacement/original",
    interfaceVersion: "1.1.0",
    evidenceDigest: DIGEST,
    occurredAt: "2026-07-29T05:00:00.000Z"
  });
  assert.equal(board.actions.find((item) => item.id === actionId).evidence.revision, 2);
});

test("overdue and escalated P0 actions remain hard stops", () => {
  let board = createExternalActionBoard(review(), { generatedAt: GENERATED_AT });
  board = applyExternalActionCommand(board, "EMG-NEXT-01", {
    action: "escalate",
    actorId: "release-commander",
    reason: "P0 site receipt missed its committed date",
    occurredAt: "2026-08-06T00:00:00.000Z"
  });
  const gate = evaluateExternalActionGate(board, "emergency-life-chain", { now: "2026-08-20T00:00:00.000Z" });
  assert.equal(gate.ok, false);
  assert.equal(gate.status, "external-actions-blocking");
  assert.ok(gate.hardStops.some((item) => item.includes("EMG-NEXT-01:escalated")));
  assert.equal(gate.productionReady, false);
});

test("accepting every action only opens formal Go/No-Go and never production automatically", () => {
  let board = createExternalActionBoard(review());
  for (const action of board.actions) {
    board = submitEvidence(board, action.id, `owner-${action.id}`);
    board = acceptEvidence(board, action.id, `reviewer-${action.id}`);
  }
  const gate = evaluateExternalActionGate(board, "emergency-life-chain", { now: "2026-07-30T00:00:00.000Z" });
  assert.equal(gate.ok, true);
  assert.equal(gate.status, "external-actions-accepted-awaiting-formal-go-no-go");
  assert.equal(gate.productionReady, false);
  assert.equal(gate.formalDecisionRequired, true);
  assert.equal(gate.nextDecision, "convene-formal-go-no-go");
});

test("accepted evidence reopens when an endpoint or interface boundary changes", () => {
  const actionId = "EMG-NEXT-01";
  let board = acceptEvidence(submitEvidence(createExternalActionBoard(review()), actionId), actionId);
  board = applyExternalActionCommand(board, actionId, {
    action: "reopen",
    actorId: "release-commander",
    changeReason: "production endpoint certificate rotated",
    changedBoundary: "certificate-fingerprint"
  });
  const row = board.actions.find((item) => item.id === actionId);
  assert.equal(row.status, "open");
  assert.equal(row.revision, 2);
  assert.equal(row.evidence, null);
});

test("workflow capability plan covers all twelve reviewed external actions", () => {
  const plan = buildExternalActionWorkflowPlan(review([
    "emergency-life-chain",
    "clinical-blood",
    "regional-imaging-cloud",
    "physical-examination"
  ]));
  assert.equal(plan.status, "external-action-workflow-code-ready");
  assert.equal(plan.summary.actions, 12);
  assert.equal(plan.summary.p0, 8);
  assert.equal(plan.summary.t00, 3);
  assert.equal(plan.trackGates.length, 4);
  assert.equal(plan.trackGates.every((item) => item.productionReady === false), true);
  assert.deepEqual(plan.generatedArtifacts.slice(-2), [
    "t10-external-action-workflow.js",
    "scripts/t10-external-action.js"
  ]);
});

test("tampering with an audit event invalidates the board", () => {
  const board = submitEvidence(createExternalActionBoard(review()), "EMG-NEXT-01");
  board.audit[0].actorId = "tampered";
  const verification = verifyExternalActionBoard(board);
  assert.equal(verification.ok, false);
  assert.equal(verification.checks.find((item) => item.id === "audit-chain").passed, false);
  assert.throws(() => applyExternalActionCommand(board, "EMG-NEXT-01", {
    action: "start-review",
    actorId: "reviewer-b"
  }), /integrity verification failed/);
});
