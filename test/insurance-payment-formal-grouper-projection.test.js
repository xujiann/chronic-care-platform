"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const Intake = require("../disease-payment-intake");
const Service = require("../disease-payment-service");

function createJob(overrides = {}) {
  return Intake.createFormalGroupingJob(Service.seedDiseasePaymentState(), {
    id: "projection-formal-job",
    idempotencyKey: "projection-formal-job-idempotency",
    mode: "DRG",
    schemeVersion: "DRG-2.0-DL",
    caseIds: ["dp-case-001"],
    maxAttempts: 2,
    ...overrides
  }, "operator");
}

test("formal grouper job ledger binds mutable state and blocks a promoted status", () => {
  const created = createJob();
  assert.equal(Intake.verifyFormalGroupingJobLedger(created.job), true);
  created.job.status = "awaiting-receipt";
  assert.equal(Intake.verifyFormalGroupingJobLedger(created.job), false);
  assert.throws(
    () => Intake.dispatchFormalGroupingJob(created.state, created.job.id, { accepted: true }, "dispatcher"),
    /状态投影或事件账本校验失败/
  );
});

test("formal grouper idempotency key cannot alias a different case snapshot", () => {
  const created = createJob();
  assert.throws(
    () => Intake.createFormalGroupingJob(created.state, {
      idempotencyKey: "projection-formal-job-idempotency",
      mode: "DRG",
      schemeVersion: "DRG-2.0-DL",
      caseIds: ["dp-case-002"]
    }, "operator"),
    /幂等键已绑定不同/
  );
});

test("formal grouper rejects ambiguous identifiers and non-integer retry limits", () => {
  const created = createJob({ correlationId: "projection-correlation" });
  assert.throws(
    () => Intake.createFormalGroupingJob(created.state, {
      id: "projection-formal-job",
      idempotencyKey: "different-idempotency",
      mode: "DRG",
      schemeVersion: "DRG-2.0-DL",
      caseIds: ["dp-case-002"]
    }, "operator"),
    /作业编号已存在/
  );
  assert.throws(
    () => Intake.createFormalGroupingJob(created.state, {
      id: "different-formal-job",
      correlationId: "projection-correlation",
      idempotencyKey: "another-idempotency",
      mode: "DRG",
      schemeVersion: "DRG-2.0-DL",
      caseIds: ["dp-case-002"]
    }, "operator"),
    /关联号已存在/
  );
  assert.throws(
    () => Intake.createFormalGroupingJob(Service.seedDiseasePaymentState(), {
      mode: "DRG",
      schemeVersion: "DRG-2.0-DL",
      caseIds: ["dp-case-001"],
      maxAttempts: 2.5
    }, "operator"),
    /最大尝试次数必须是1至5之间的整数/
  );
});

test("formal grouper callback is blocked when the attempt projection was modified", () => {
  const created = createJob();
  const dispatched = Intake.dispatchFormalGroupingJob(created.state, created.job.id, { accepted: true, transportId: "projection-transport" }, "dispatcher");
  assert.equal(Intake.verifyFormalGroupingJobLedger(dispatched.job), true);
  dispatched.job.attemptCount = 0;
  assert.equal(Intake.verifyFormalGroupingJobLedger(dispatched.job), false);
  assert.throws(
    () => Intake.receiveFormalGroupingReceipt(dispatched.state, dispatched.job.id, { correlationId: dispatched.job.correlationId, officialResults: [] }, "adapter", Service.calculateCase),
    /状态投影或事件账本校验失败/
  );
});

test("formal grouper callback rejects a receipt identifier reused within one job", () => {
  const created = createJob({ caseIds: ["dp-case-001", "dp-case-002"] });
  const dispatched = Intake.dispatchFormalGroupingJob(created.state, created.job.id, { accepted: true }, "dispatcher");
  const received = Intake.receiveFormalGroupingReceipt(dispatched.state, dispatched.job.id, {
    correlationId: dispatched.job.correlationId,
    officialResults: dispatched.job.caseSnapshots.map((snapshot) => ({
      caseId: snapshot.caseId,
      receiptId: "DUPLICATE-OFFICIAL-RECEIPT",
      groupCode: "BR23",
      schemeVersion: dispatched.job.schemeVersion,
      inputDigest: snapshot.inputDigest,
      signedAt: new Date().toISOString()
    }))
  }, "adapter", Service.calculateCase);
  assert.equal(received.job.status, "receipt-rejected");
  assert.match(received.receiptErrors.join("；"), /回执编号在同一作业内重复/);
  assert.equal(Intake.verifyFormalGroupingJobLedger(received.job), true);
});

test("formal grouper dead-letter ledger blocks a forged reconciliation state", () => {
  const created = createJob();
  const first = Intake.dispatchFormalGroupingJob(created.state, created.job.id, { accepted: false, errorCode: "TIMEOUT", errorMessage: "首次超时" }, "dispatcher");
  const queued = Intake.retryFormalGroupingJob(first.state, first.job.id, "operator");
  const dead = Intake.dispatchFormalGroupingJob(queued.state, queued.job.id, { accepted: false, errorCode: "UNAVAILABLE", errorMessage: "正式分组器不可用" }, "dispatcher");
  const deadLetter = dead.state.formalGroupingDeadLetters[0];
  assert.equal(Intake.verifyFormalGroupingJobLedger(dead.job), true);
  assert.equal(Intake.verifyFormalGroupingDeadLetter(deadLetter), true);
  deadLetter.errorMessage = "伪造的已核对错误详情";
  assert.equal(Intake.verifyFormalGroupingDeadLetter(deadLetter), false);
  assert.throws(
    () => Intake.reconcileFormalGroupingDeadLetter(dead.state, dead.job.id, { resolution: "伪造对账结论" }, "reconciler"),
    /死信状态投影或事件账本校验失败/
  );
});

test("formal grouper operations expose integrity without clinical snapshots or sensitive details", () => {
  const created = createJob();
  const first = Intake.dispatchFormalGroupingJob(created.state, created.job.id, { accepted: false, endpoint: "private-adapter-endpoint", errorCode: "TIMEOUT", errorMessage: "含内部链路详情" }, "dispatcher");
  const queued = Intake.retryFormalGroupingJob(first.state, first.job.id, "operator");
  const dead = Intake.dispatchFormalGroupingJob(queued.state, queued.job.id, { accepted: false, errorCode: "UNAVAILABLE", errorMessage: "含内部死信详情" }, "dispatcher");
  const operations = Intake.buildFormalGroupingOperations(dead.state);
  const serialized = JSON.stringify(operations);
  assert.equal(operations.summary.invalidJobs, 0);
  assert.equal(operations.summary.invalidDeadLetters, 0);
  assert.equal(operations.jobs[0].integrity, true);
  assert.equal(operations.deadLetters[0].integrity, true);
  assert.equal(operations.jobs[0].caseCount, 1);
  assert.equal(operations.jobs[0].caseSnapshots, undefined);
  assert.equal(operations.deadLetters[0].errorMessage, undefined);
  assert.equal(serialized.includes("principalDiagnosis"), false);
  assert.equal(serialized.includes("private-adapter-endpoint"), false);
  assert.equal(serialized.includes("含内部死信详情"), false);
});

test("formal grouper retry and dead-letter reconciliation preserve both projections", () => {
  const created = createJob();
  const first = Intake.dispatchFormalGroupingJob(created.state, created.job.id, { accepted: false }, "dispatcher");
  const queued = Intake.retryFormalGroupingJob(first.state, first.job.id, "operator");
  const dead = Intake.dispatchFormalGroupingJob(queued.state, queued.job.id, { accepted: false }, "dispatcher");
  const reconciled = Intake.reconcileFormalGroupingDeadLetter(dead.state, dead.job.id, { resolution: "医保侧恢复后允许重新派发" }, "reconciler");
  assert.equal(Intake.verifyFormalGroupingJobLedger(reconciled.job), true);
  assert.equal(Intake.verifyFormalGroupingDeadLetter(reconciled.deadLetter), true);
  assert.equal(reconciled.job.events.at(-1).type, "dead-letter-reconciled");
  assert.equal(reconciled.deadLetter.events.at(-1).type, "resolved");
});

test("formal grouper job ledger rejects a rehashed but semantically impossible transition", () => {
  const created = createJob();
  const forged = {
    id: "forged-event",
    type: "completed",
    status: "completed",
    attemptCount: 0,
    actor: "forger",
    detail: "skip adapter dispatch and receipt",
    projectionDigest: created.job.events[0].projectionDigest,
    sequence: 2,
    previousHash: created.job.events[0].eventHash,
    at: new Date().toISOString()
  };
  created.job.events.push({ ...forged, eventHash: Intake.digest(forged) });
  created.job.status = "completed";
  assert.equal(Intake.verifyFormalGroupingJobLedger(created.job), false);
});
