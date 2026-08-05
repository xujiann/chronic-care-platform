"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const sourceData = require("../data/db.json");
const {
  DEFAULT_INFECTIOUS_EVENT_LINK,
  applyInfectiousReportingAction,
  buildInfectiousReportingCaseFromSources
} = require("../public-health-event-reporting-service");
const {
  buildDirectReportDeliveryInput,
  claimDirectReportDeliveryToState,
  enqueueDirectReportDeliveryToState,
  listDueDirectReportDeliveries,
  projectDirectReportDelivery,
  recordDirectReportDeliveryOutcomeToState,
  recordTrustedDirectReportCallbackToState,
  requeueDirectReportDeadLetterToState
} = require("../public-health-direct-report-outbox-service");

const REFERENCE_SECRET = "public-health-reference-secret-for-outbox-tests";

function submittedWorkflow() {
  const event = sourceData.publicHealthEvents.find(
    (item) => item.id === DEFAULT_INFECTIOUS_EVENT_LINK.publicHealthEventId
  );
  const report = sourceData.phase2DiseaseReportQueue.find(
    (item) => item.id === DEFAULT_INFECTIOUS_EVENT_LINK.reportId
  );
  let workflow = buildInfectiousReportingCaseFromSources({
    event,
    report,
    link: DEFAULT_INFECTIOUS_EVENT_LINK
  });
  const actor = { name: "commission reporter", role: "commission" };
  workflow = applyInfectiousReportingAction(workflow, {
    action: "validate-event",
    idempotencyKey: "outbox:validate",
    at: "2026-08-05T08:00:00.000Z"
  }, actor).case;
  workflow = applyInfectiousReportingAction(workflow, {
    action: "create-report-card",
    idempotencyKey: "outbox:card",
    at: "2026-08-05T08:01:00.000Z",
    reportCard: {
      sourceInstitutionCode: "210200001",
      testCode: "TB-PCR",
      resultFlag: "positive",
      reportType: "infectious-disease-case",
      occurredAt: "2026-08-05T07:30:00.000Z",
      reportedAt: "2026-08-05T08:01:00.000Z"
    }
  }, actor).case;
  return applyInfectiousReportingAction(workflow, {
    action: "submit-report",
    idempotencyKey: "outbox:submit:1",
    at: "2026-08-05T08:02:00.000Z"
  }, actor).case;
}

test("submission enqueues one digest-bound delivery without payload or resident identity", () => {
  const workflow = submittedWorkflow();
  const first = enqueueDirectReportDeliveryToState(
    { publicHealthInfectiousReportingCases: [workflow] },
    workflow,
    { at: "2026-08-05T08:02:00.000Z" }
  );
  assert.equal(first.idempotent, false);
  assert.equal(first.delivery.state, "queued");
  assert.equal(first.delivery.caseId, workflow.id);
  assert.equal(first.delivery.payloadPersisted, false);
  assert.equal(first.delivery.subjectDataPersisted, false);
  assert.equal(Object.hasOwn(first.delivery, "residentId"), false);
  assert.equal(Object.hasOwn(first.delivery, "sampleNo"), false);
  assert.equal(Object.hasOwn(first.delivery, "payload"), false);
  assert.doesNotMatch(JSON.stringify(first.delivery), new RegExp(workflow.event.sampleNo));

  const replay = enqueueDirectReportDeliveryToState(first.nextData, workflow, {
    at: "2026-08-05T08:03:00.000Z"
  });
  assert.equal(replay.idempotent, true);
  assert.equal(replay.nextData.publicHealthInfectiousReportingDeliveries.length, 1);

  const drift = structuredClone(workflow);
  drift.reportCard.testCode = "DRIFTED-CODE";
  assert.throws(
    () => enqueueDirectReportDeliveryToState(first.nextData, drift),
    /idempotency binding has drifted/
  );
});

test("lease versioning, bounded retry, dead letter and replay are recoverable", () => {
  const workflow = submittedWorkflow();
  const queued = enqueueDirectReportDeliveryToState({
    publicHealthInfectiousReportingCases: [workflow]
  }, workflow, {
    at: "2026-08-05T08:02:00.000Z",
    maxAttempts: 2
  });
  const claimed = claimDirectReportDeliveryToState(queued.nextData, queued.delivery.id, {
    expectedVersion: 1,
    workerId: "worker-a",
    leaseSeconds: 60,
    now: "2026-08-05T08:03:00.000Z"
  }, { randomUUID: () => "lease-token-a" });
  assert.equal(claimed.delivery.state, "leased");
  assert.throws(
    () => claimDirectReportDeliveryToState(claimed.nextData, queued.delivery.id, {
      expectedVersion: 2,
      workerId: "worker-b",
      now: "2026-08-05T08:03:10.000Z"
    }),
    /active worker lease/
  );
  assert.throws(
    () => recordDirectReportDeliveryOutcomeToState(claimed.nextData, queued.delivery.id, {
      accepted: false,
      code: "NETWORK_TIMEOUT",
      retryable: true
    }, {
      expectedVersion: 2,
      leaseToken: "wrong-token",
      now: "2026-08-05T08:03:20.000Z"
    }),
    /lease token does not match/
  );
  const retry = recordDirectReportDeliveryOutcomeToState(claimed.nextData, queued.delivery.id, {
    accepted: false,
    code: "NETWORK_TIMEOUT",
    retryable: true
  }, {
    expectedVersion: 2,
    leaseToken: claimed.leaseToken,
    now: "2026-08-05T08:03:20.000Z"
  });
  assert.equal(retry.delivery.state, "retry-scheduled");
  assert.equal(listDueDirectReportDeliveries(retry.nextData, {
    now: "2026-08-05T08:03:30.000Z"
  }).length, 0);

  const secondClaim = claimDirectReportDeliveryToState(retry.nextData, queued.delivery.id, {
    expectedVersion: 3,
    workerId: "worker-b",
    now: "2026-08-05T08:04:00.000Z"
  }, { randomUUID: () => "lease-token-b" });
  const dead = recordDirectReportDeliveryOutcomeToState(secondClaim.nextData, queued.delivery.id, {
    accepted: false,
    code: "NETWORK_TIMEOUT",
    retryable: true
  }, {
    expectedVersion: 4,
    leaseToken: secondClaim.leaseToken,
    now: "2026-08-05T08:04:10.000Z"
  });
  assert.equal(dead.delivery.state, "dead-letter");
  assert.equal(dead.delivery.attemptCount, 2);
  const replayed = requeueDirectReportDeadLetterToState(dead.nextData, dead.delivery.id, {
    expectedVersion: 5,
    idempotencyKey: "replay:1",
    at: "2026-08-05T08:05:00.000Z"
  });
  assert.equal(replayed.delivery.state, "queued");
  assert.equal(replayed.delivery.replayCount, 1);
  assert.equal(replayed.delivery.attemptCount, 0);
  assert.equal(replayed.delivery.lifetimeAttemptCount, 2);
  assert.equal(
    requeueDirectReportDeadLetterToState(replayed.nextData, dead.delivery.id, {
      expectedVersion: 5,
      idempotencyKey: "replay:1",
      at: "2026-08-05T08:06:00.000Z"
    }).idempotent,
    true
  );
});

test("provider acknowledgement waits for a separately verified terminal callback", () => {
  const workflow = submittedWorkflow();
  const queued = enqueueDirectReportDeliveryToState({}, workflow, {
    at: "2026-08-05T08:02:00.000Z"
  });
  const claimed = claimDirectReportDeliveryToState(queued.nextData, queued.delivery.id, {
    expectedVersion: 1,
    workerId: "worker-a",
    now: "2026-08-05T08:03:00.000Z"
  }, { randomUUID: () => "lease-token-a" });
  const acknowledged = recordDirectReportDeliveryOutcomeToState(claimed.nextData, queued.delivery.id, {
    accepted: true,
    receiptId: "provider-receipt-1",
    requestId: queued.delivery.id,
    providerStatus: "accepted",
    acceptedAt: "2026-08-05T08:03:10.000Z",
    transportAttempts: 1
  }, {
    expectedVersion: 2,
    leaseToken: claimed.leaseToken,
    now: "2026-08-05T08:03:10.000Z"
  });
  assert.equal(acknowledged.delivery.state, "awaiting-callback");
  assert.equal(acknowledged.delivery.trustedCallback, null);

  const callback = recordTrustedDirectReportCallbackToState(acknowledged.nextData, {
    caseId: workflow.id,
    receiptId: "provider-receipt-1",
    status: "accepted",
    at: "2026-08-05T08:04:00.000Z"
  });
  assert.equal(callback.matched, true);
  assert.equal(callback.delivery.state, "callback-accepted");
  assert.equal(callback.delivery.trustedCallback.signatureVerified, true);
  assert.equal(
    recordTrustedDirectReportCallbackToState(callback.nextData, {
      caseId: workflow.id,
      receiptId: "provider-receipt-1",
      status: "accepted",
      at: "2026-08-05T08:04:00.000Z"
    }).idempotent,
    true
  );
  assert.throws(
    () => recordTrustedDirectReportCallbackToState(callback.nextData, {
      caseId: workflow.id,
      receiptId: "provider-receipt-1",
      status: "rejected",
      at: "2026-08-05T08:04:00.000Z"
    }),
    /conflicts/
  );
});

test("dead-letter replay is blocked after the bound case leaves submitted state", () => {
  const workflow = submittedWorkflow();
  const queued = enqueueDirectReportDeliveryToState({
    publicHealthInfectiousReportingCases: [workflow]
  }, workflow, {
    at: "2026-08-05T08:02:00.000Z",
    maxAttempts: 1
  });
  const claimed = claimDirectReportDeliveryToState(queued.nextData, queued.delivery.id, {
    expectedVersion: 1,
    workerId: "worker-a",
    now: "2026-08-05T08:03:00.000Z"
  }, { randomUUID: () => "lease-token-a" });
  const dead = recordDirectReportDeliveryOutcomeToState(claimed.nextData, queued.delivery.id, {
    accepted: false,
    code: "UPSTREAM_TIMEOUT",
    retryable: true
  }, {
    expectedVersion: 2,
    leaseToken: claimed.leaseToken,
    now: "2026-08-05T08:03:05.000Z"
  });
  dead.nextData.publicHealthInfectiousReportingCases[0].state = "receipt-confirmed";
  assert.throws(
    () => requeueDirectReportDeadLetterToState(dead.nextData, dead.delivery.id, {
      expectedVersion: dead.delivery.version,
      idempotencyKey: "replay-after-receipt",
      at: "2026-08-05T08:04:00.000Z"
    }),
    /remain submitted/
  );
});

test("worker request builds only keyed references and public projection strips control digests", () => {
  const workflow = submittedWorkflow();
  const request = buildDirectReportDeliveryInput(workflow, {
    deliveryId: "phdr-delivery-test",
    env: {
      NODE_ENV: "production",
      PUBLIC_HEALTH_REFERENCE_SECRET: REFERENCE_SECRET
    },
    nowMs: Date.parse("2026-08-05T08:02:00.000Z")
  });
  assert.match(request.payload.subjectReference, /^hmac-sha256:v1:[a-f0-9]{64}$/);
  assert.match(request.payload.specimenReference, /^hmac-sha256:v1:[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(request.payload), new RegExp(workflow.event.residentId));
  assert.doesNotMatch(JSON.stringify(request.payload), new RegExp(workflow.event.sampleNo));

  const queued = enqueueDirectReportDeliveryToState({}, workflow, {
    at: "2026-08-05T08:02:00.000Z"
  });
  const view = projectDirectReportDelivery(queued.delivery, {
    now: "2026-08-05T08:02:00.000Z"
  });
  assert.equal(view.payloadPersisted, false);
  assert.equal(view.subjectDataPersisted, false);
  assert.doesNotMatch(JSON.stringify(view), /Digest|submissionKey|bindingDigest|tokenDigest|workerIdDigest/);
});
