"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const sourceData = require("../data/db.json");
const {
  DEFAULT_INFECTIOUS_EVENT_LINK,
  applyInfectiousReportingAction,
  buildInfectiousReportingCaseFromSources,
  upsertInfectiousReportingCase
} = require("../public-health-event-reporting-service");
const {
  DIRECT_REPORT_CONTRACT_ID,
  signDirectReportCallback,
  verifyDirectReportCallback
} = require("../public-health-connectors");
const {
  claimDirectReportDeliveryToState,
  enqueueDirectReportDeliveryToState,
  projectDirectReportDelivery,
  recordDirectReportDeliveryOutcomeToState,
  recordTrustedDirectReportCallbackToState,
  requeueDirectReportDeadLetterToState
} = require("../public-health-direct-report-outbox-service");
const {
  createRouteSegment
} = require("../src/http/routes/public-health/infectious-reporting");

const CALLBACK_SECRET = "runtime-direct-report-callback-secret-32-characters";
const CALLBACK_NOW = Date.parse("2026-08-05T08:00:00.000Z");

test("central state schema preserves infectious reporting delivery commands", () => {
  const serverSource = fs.readFileSync(path.resolve(__dirname, "../server.js"), "utf8");
  const occurrences = serverSource.match(/publicHealthInfectiousReportingDeliveries/g) || [];
  assert.equal(occurrences.length >= 2, true);
  assert.match(
    serverSource,
    /publicHealthInfectiousReportingDeliveries:\s*Array\.isArray\(data\.publicHealthInfectiousReportingDeliveries\)/
  );
});

function fixture() {
  let data = structuredClone(sourceData);
  data.publicHealthInfectiousReportingCases = [];
  data.publicHealthInfectiousReportingDeliveries = [];
  data.securityEvents = [];
  data.dataAccessLogs = [];
  let payload = {};
  let response = null;
  let sequence = 0;
  const runtime = {
    DIRECT_REPORT_CONTRACT_ID,
    appendDataAccessLog(target, user, residentId, scope, purpose, result) {
      target.dataAccessLogs = [{
        actor: user.name,
        residentId,
        scope,
        purpose,
        result
      }, ...(target.dataAccessLogs || [])];
    },
    appendSecurityEvent(event) {
      data.securityEvents = [structuredClone(event), ...(data.securityEvents || [])];
    },
    applyInfectiousReportingAction,
    buildInfectiousReportingCaseFromSources,
    collectJson: async () => structuredClone(payload),
    enqueueDirectReportDeliveryToState,
    projectDirectReportDelivery,
    publicDirectReportControlStatus: () => ({
      activationReady: false,
      codeReady: true,
      scenariosPassed: 0,
      scenariosRequired: 8,
      signerRoles: [],
      blockerCode: "PUBLIC_HEALTH_DIRECT_REPORT_CONTROL_FILES_REQUIRED",
      credentialsExposed: false,
      payloadsExposed: false,
      productionReady: false
    }),
    randomUUID: () => `runtime-${++sequence}`,
    readDatabase: () => structuredClone(data),
    requireApiRole: () => ({ name: "commission-user", role: "commission" }),
    sealAuditTrail: (rows) => rows,
    sendJson: (_res, status, body) => { response = { status, body }; },
    recordTrustedDirectReportCallbackToState,
    requeueDirectReportDeadLetterToState,
    upsertInfectiousReportingCase,
    verifyDirectReportCallback: (body, options) => verifyDirectReportCallback(body, {
      ...options,
      env: {
        NODE_ENV: "production",
        PUBLIC_HEALTH_DIRECT_REPORT_CALLBACK_SECRET: CALLBACK_SECRET
      },
      nowMs: CALLBACK_NOW
    }),
    writeDatabase: (next) => { data = structuredClone(next); }
  };
  return {
    segment: createRouteSegment(runtime),
    get data() { return structuredClone(data); },
    get response() { return response; },
    replaceData(value) { data = structuredClone(value); },
    setPayload(value) { payload = structuredClone(value); }
  };
}

test("commission can read only the minimized direct-report control package projection", async () => {
  const row = fixture();
  const response = await request(
    row,
    "GET",
    "/api/public-health/infectious-reporting-control-package"
  );
  assert.equal(response.status, 200);
  assert.equal(response.body.controlPackage.activationReady, false);
  assert.equal(
    response.body.controlPackage.blockerCode,
    "PUBLIC_HEALTH_DIRECT_REPORT_CONTROL_FILES_REQUIRED"
  );
  assert.equal(response.body.credentialsExposed, false);
  assert.equal(response.body.payloadsExposed, false);
  assert.equal(response.body.productionReady, false);
  assert.doesNotMatch(JSON.stringify(response.body), /publicKeyPem|signature|secret|codes/i);
});

async function request(row, method, pathname, payload, headers = {}) {
  row.setPayload(payload || {});
  const handled = await row.segment.handle(
    { method, headers },
    {},
    new URL(`http://localhost${pathname}`)
  );
  assert.equal(handled, true);
  return row.response;
}

async function createSubmittedCase(row) {
  const created = await request(
    row,
    "POST",
    "/api/public-health/infectious-reporting-cases",
    {
      externalEventId: DEFAULT_INFECTIOUS_EVENT_LINK.externalEventId,
      publicHealthEventId: DEFAULT_INFECTIOUS_EVENT_LINK.publicHealthEventId,
      reportId: DEFAULT_INFECTIOUS_EVENT_LINK.reportId,
      sampleNo: DEFAULT_INFECTIOUS_EVENT_LINK.sampleNo
    }
  );
  const caseId = created.body.case.id;
  const actionPath = `/api/public-health/infectious-reporting-cases/${encodeURIComponent(caseId)}/actions`;
  await request(row, "POST", actionPath, {
    action: "validate-event",
    idempotencyKey: "callback-validate",
    expectedVersion: 1,
    note: "source fields checked"
  });
  await request(row, "POST", actionPath, {
    action: "create-report-card",
    idempotencyKey: "callback-card",
    expectedVersion: 2,
    note: "report card created"
  });
  const submitted = await request(row, "POST", actionPath, {
    action: "submit-report",
    idempotencyKey: "callback-submit",
    expectedVersion: 3,
    note: "submitted to direct-report platform"
  });
  assert.equal(submitted.body.case.state, "submitted");
  return { caseId, actionPath, case: submitted.body.case };
}

test("commission API persists one bound reporting case and audits reads", async () => {
  const row = fixture();
  const input = {
    externalEventId: DEFAULT_INFECTIOUS_EVENT_LINK.externalEventId,
    publicHealthEventId: DEFAULT_INFECTIOUS_EVENT_LINK.publicHealthEventId,
    reportId: DEFAULT_INFECTIOUS_EVENT_LINK.reportId,
    sampleNo: DEFAULT_INFECTIOUS_EVENT_LINK.sampleNo
  };
  const created = await request(
    row,
    "POST",
    "/api/public-health/infectious-reporting-cases",
    input
  );
  assert.equal(created.status, 201);
  assert.equal(created.body.created, true);
  assert.equal(created.body.case.state, "detected");
  assert.equal(created.body.productionReady, false);
  const caseId = created.body.case.id;

  const replay = await request(
    row,
    "POST",
    "/api/public-health/infectious-reporting-cases",
    input
  );
  assert.equal(replay.status, 200);
  assert.equal(replay.body.idempotent, true);
  assert.equal(row.data.publicHealthInfectiousReportingCases.length, 1);

  const read = await request(
    row,
    "GET",
    `/api/public-health/infectious-reporting-cases/${encodeURIComponent(caseId)}`
  );
  assert.equal(read.status, 200);
  assert.equal(read.body.case.id, caseId);
  assert.equal(row.data.dataAccessLogs.length, 3);
  assert.equal(
    row.data.securityEvents.every((entry) => !entry.detail.includes(read.body.case.event.residentId)),
    true
  );
});

test("action API requires versions, preserves idempotency and rejects unsigned receipts", async () => {
  const row = fixture();
  const created = await request(
    row,
    "POST",
    "/api/public-health/infectious-reporting-cases",
    {
      externalEventId: DEFAULT_INFECTIOUS_EVENT_LINK.externalEventId,
      publicHealthEventId: DEFAULT_INFECTIOUS_EVENT_LINK.publicHealthEventId,
      reportId: DEFAULT_INFECTIOUS_EVENT_LINK.reportId,
      sampleNo: DEFAULT_INFECTIOUS_EVENT_LINK.sampleNo
    }
  );
  const caseId = created.body.case.id;
  const actionPath = `/api/public-health/infectious-reporting-cases/${encodeURIComponent(caseId)}/actions`;

  const validated = await request(row, "POST", actionPath, {
    action: "validate-event",
    idempotencyKey: "validate-1",
    expectedVersion: 1,
    note: "source fields checked",
    at: "2026-08-05T08:00:00.000Z"
  });
  assert.equal(validated.status, 200);
  assert.equal(validated.body.idempotent, false);
  assert.equal(validated.body.case.version, 2);

  const replay = await request(row, "POST", actionPath, {
    action: "validate-event",
    idempotencyKey: "validate-1",
    expectedVersion: 1,
    note: "source fields checked",
    at: "2026-08-05T08:01:00.000Z"
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.idempotent, true);
  assert.equal(replay.body.case.version, 2);

  const drift = await request(row, "POST", actionPath, {
    action: "validate-event",
    idempotencyKey: "validate-1",
    expectedVersion: 1,
    note: "different command intent"
  });
  assert.equal(drift.status, 409);
  assert.match(drift.body.message, /idempotency conflict/);

  const stale = await request(row, "POST", actionPath, {
    action: "create-report-card",
    idempotencyKey: "card-1",
    expectedVersion: 1
  });
  assert.equal(stale.status, 409);
  assert.match(stale.body.message, /version conflict/);

  const unsignedReceipt = await request(row, "POST", actionPath, {
    action: "record-receipt",
    idempotencyKey: "receipt-1",
    expectedVersion: 2,
    receiptStatus: "accepted"
  });
  assert.equal(unsignedReceipt.status, 409);
  assert.equal(unsignedReceipt.body.code, "PUBLIC_HEALTH_SIGNED_RECEIPT_REQUIRED");
  assert.equal(unsignedReceipt.body.productionReady, false);
});

test("submit action atomically enqueues one minimized delivery and dead letters can be requeued", async () => {
  const row = fixture();
  const { caseId, actionPath } = await createSubmittedCase(row);
  assert.equal(row.data.publicHealthInfectiousReportingDeliveries.length, 1);
  const queued = row.data.publicHealthInfectiousReportingDeliveries[0];
  assert.equal(queued.caseId, caseId);
  assert.equal(queued.state, "queued");
  assert.equal(queued.payloadPersisted, false);
  assert.equal(Object.hasOwn(queued, "payload"), false);
  assert.equal(Object.hasOwn(queued, "residentId"), false);

  const replay = await request(row, "POST", actionPath, {
    action: "submit-report",
    idempotencyKey: "callback-submit",
    expectedVersion: 3,
    note: "submitted to direct-report platform"
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.idempotent, true);
  assert.equal(replay.body.delivery.id, queued.id);
  assert.equal(row.data.publicHealthInfectiousReportingDeliveries.length, 1);

  const list = await request(
    row,
    "GET",
    "/api/public-health/infectious-reporting-deliveries"
  );
  assert.equal(list.status, 200);
  assert.equal(list.body.summary.total, 1);
  assert.equal(list.body.summary.queued, 1);
  assert.equal(list.body.payloadsExposed, false);
  assert.equal(list.body.subjectDataExposed, false);
  assert.doesNotMatch(
    JSON.stringify(list.body),
    /submissionKeyDigest|bindingDigest|tokenDigest|workerIdDigest|residentId|sampleNo/
  );

  const claimed = claimDirectReportDeliveryToState(row.data, queued.id, {
    expectedVersion: 1,
    workerId: "runtime-worker",
    now: "2026-08-05T07:55:00.000Z"
  }, { randomUUID: () => "runtime-worker-lease" });
  const dead = recordDirectReportDeliveryOutcomeToState(claimed.nextData, queued.id, {
    accepted: false,
    code: "DIRECT_REPORT_CONTRACT_REJECTED",
    retryable: false
  }, {
    expectedVersion: 2,
    leaseToken: claimed.leaseToken,
    now: "2026-08-05T07:55:10.000Z"
  });
  row.replaceData(dead.nextData);
  const retried = await request(
    row,
    "POST",
    `/api/public-health/infectious-reporting-deliveries/${encodeURIComponent(queued.id)}/retry`,
    {
      expectedVersion: dead.delivery.version,
      idempotencyKey: "runtime-dead-letter-retry",
      at: "2026-08-05T07:56:00.000Z"
    }
  );
  assert.equal(retried.status, 200);
  assert.equal(retried.body.delivery.state, "queued");
  assert.equal(retried.body.delivery.replayCount, 1);

  const retryReplay = await request(
    row,
    "POST",
    `/api/public-health/infectious-reporting-deliveries/${encodeURIComponent(queued.id)}/retry`,
    {
      expectedVersion: dead.delivery.version,
      idempotencyKey: "runtime-dead-letter-retry",
      at: "2026-08-05T07:57:00.000Z"
    }
  );
  assert.equal(retryReplay.status, 200);
  assert.equal(retryReplay.body.idempotent, true);
});

test("signed direct-report callback persists one trusted receipt and exposes a minimized timeline", async () => {
  const row = fixture();
  const { caseId } = await createSubmittedCase(row);
  const callbackPath = `/api/public-health/infectious-reporting-cases/${encodeURIComponent(caseId)}/direct-report-callback`;
  const payload = {
    eventId: DEFAULT_INFECTIOUS_EVENT_LINK.externalEventId,
    receiptId: "cdc-runtime-receipt-001",
    status: "accepted",
    occurredAt: "2026-08-05T07:59:00.000Z",
    providerCode: "CDC-RUNTIME-001"
  };
  const queued = row.data.publicHealthInfectiousReportingDeliveries[0];
  const claimed = claimDirectReportDeliveryToState(row.data, queued.id, {
    expectedVersion: queued.version,
    workerId: "runtime-worker",
    now: "2026-08-05T07:58:00.000Z"
  }, { randomUUID: () => "runtime-worker-lease" });
  const acknowledged = recordDirectReportDeliveryOutcomeToState(
    claimed.nextData,
    queued.id,
    {
      accepted: true,
      receiptId: payload.receiptId,
      requestId: queued.id,
      providerStatus: "accepted",
      acceptedAt: "2026-08-05T07:58:30.000Z",
      transportAttempts: 1
    },
    {
      expectedVersion: claimed.delivery.version,
      leaseToken: claimed.leaseToken,
      now: "2026-08-05T07:58:30.000Z"
    }
  );
  row.replaceData(acknowledged.nextData);
  const timestamp = String(CALLBACK_NOW);
  const nonce = "cdc-runtime-nonce-001";
  const signature = signDirectReportCallback(payload, {
    secret: CALLBACK_SECRET,
    timestamp,
    nonce
  });
  const headers = {
    "x-public-health-direct-report-timestamp": timestamp,
    "x-public-health-direct-report-nonce": nonce,
    "x-public-health-direct-report-signature": `sha256=${signature}`
  };

  const unsigned = await request(row, "POST", callbackPath, payload, {
    "x-public-health-direct-report-timestamp": timestamp,
    "x-public-health-direct-report-nonce": nonce
  });
  assert.equal(unsigned.status, 401);
  assert.equal(unsigned.body.code, "DIRECT_REPORT_CALLBACK_SIGNATURE_INVALID");

  const accepted = await request(row, "POST", callbackPath, payload, headers);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.idempotent, false);
  assert.equal(accepted.body.case.state, "receipt-confirmed");
  assert.equal(accepted.body.case.receipt.trusted, true);
  assert.equal(accepted.body.case.delivery.state, "callback-accepted");
  assert.equal(accepted.body.deliveryMatched, true);
  assert.equal(accepted.body.callback.signatureVerified, true);
  assert.equal(accepted.body.productionReady, false);
  assert.equal("nonceDigest" in accepted.body.callback, false);

  const replay = await request(row, "POST", callbackPath, payload, headers);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.idempotent, true);
  assert.equal(replay.body.case.version, accepted.body.case.version);

  const list = await request(
    row,
    "GET",
    "/api/public-health/infectious-reporting-cases"
  );
  assert.equal(list.status, 200);
  assert.equal(list.body.summary.total, 1);
  assert.equal(list.body.summary.trustedReceipts, 1);
  assert.equal(list.body.cases[0].timeline.at(-1).action, "record-receipt");
  assert.doesNotMatch(JSON.stringify(list.body), /intentDigest|idempotencyKey|residentId|nonceDigest/);
  assert.doesNotMatch(
    JSON.stringify(list.body),
    new RegExp(DEFAULT_INFECTIOUS_EVENT_LINK.sampleNo)
  );

  const persisted = JSON.stringify(row.data);
  assert.doesNotMatch(persisted, new RegExp(nonce));
  assert.doesNotMatch(persisted, new RegExp(signature));
  assert.doesNotMatch(persisted, new RegExp(CALLBACK_SECRET));
  assert.equal(
    row.data.publicHealthInfectiousReportingCases[0].receipt.trustedCallback.nonceDigest.length,
    64
  );
});

test("signed callback rejects event drift non-terminal states and nonce intent drift", async () => {
  const row = fixture();
  const { caseId } = await createSubmittedCase(row);
  const callbackPath = `/api/public-health/infectious-reporting-cases/${encodeURIComponent(caseId)}/direct-report-callback`;
  const timestamp = String(CALLBACK_NOW);
  const nonce = "cdc-runtime-nonce-drift-001";
  const signedRequest = async (payload) => request(row, "POST", callbackPath, payload, {
    "x-public-health-direct-report-timestamp": timestamp,
    "x-public-health-direct-report-nonce": nonce,
    "x-public-health-direct-report-signature": signDirectReportCallback(payload, {
      secret: CALLBACK_SECRET,
      timestamp,
      nonce
    })
  });

  const mismatched = await signedRequest({
    eventId: "another-external-event",
    receiptId: "cdc-runtime-receipt-drift-001",
    status: "accepted",
    occurredAt: "2026-08-05T07:59:00.000Z"
  });
  assert.equal(mismatched.status, 409);
  assert.equal(mismatched.body.code, "PUBLIC_HEALTH_DIRECT_REPORT_CALLBACK_BINDING_MISMATCH");

  const processing = await signedRequest({
    eventId: DEFAULT_INFECTIOUS_EVENT_LINK.externalEventId,
    receiptId: "cdc-runtime-receipt-processing-001",
    status: "processing",
    occurredAt: "2026-08-05T07:59:00.000Z"
  });
  assert.equal(processing.status, 409);
  assert.equal(processing.body.code, "PUBLIC_HEALTH_DIRECT_REPORT_CALLBACK_NOT_TERMINAL");

  const acceptedPayload = {
    eventId: DEFAULT_INFECTIOUS_EVENT_LINK.externalEventId,
    receiptId: "cdc-runtime-receipt-drift-001",
    status: "accepted",
    occurredAt: "2026-08-05T07:59:00.000Z"
  };
  const accepted = await signedRequest(acceptedPayload);
  assert.equal(accepted.status, 200);

  const drifted = await signedRequest({
    ...acceptedPayload,
    status: "rejected",
    failureReason: "provider rejected the report"
  });
  assert.equal(drifted.status, 409);
  assert.match(drifted.body.message, /idempotency conflict/);
  assert.equal(row.data.publicHealthInfectiousReportingCases[0].receipt.receiptStatus, "accepted");
});

test("signed rejected callback opens generic compensation without persisting an upstream message", async () => {
  const row = fixture();
  const { caseId } = await createSubmittedCase(row);
  const callbackPath = `/api/public-health/infectious-reporting-cases/${encodeURIComponent(caseId)}/direct-report-callback`;
  const payload = {
    eventId: DEFAULT_INFECTIOUS_EVENT_LINK.externalEventId,
    receiptId: "cdc-runtime-rejected-001",
    status: "rejected",
    occurredAt: "2026-08-05T07:59:00.000Z",
    failureReason: "raw upstream database trace must never persist"
  };
  const timestamp = String(CALLBACK_NOW);
  const nonce = "cdc-runtime-rejected-nonce-001";
  const signature = signDirectReportCallback(payload, {
    secret: CALLBACK_SECRET,
    timestamp,
    nonce
  });
  const rejected = await request(row, "POST", callbackPath, payload, {
    "x-public-health-direct-report-timestamp": timestamp,
    "x-public-health-direct-report-nonce": nonce,
    "x-public-health-direct-report-signature": signature
  });

  assert.equal(rejected.status, 200);
  assert.equal(rejected.body.case.state, "rejected");
  assert.equal(rejected.body.case.receipt.trusted, true);
  const persisted = row.data.publicHealthInfectiousReportingCases[0];
  assert.equal(persisted.exception.owner, "public-health-direct-report-operations");
  assert.equal(
    persisted.exception.reason,
    "direct-report platform rejected the submission"
  );
  assert.doesNotMatch(JSON.stringify(row.data), /raw upstream database trace/);
  assert.doesNotMatch(JSON.stringify(rejected.body), /raw upstream database trace/);
});

test("one verified callback nonce cannot be rebound across reporting cases", async () => {
  const row = fixture();
  const { caseId } = await createSubmittedCase(row);
  const nextData = row.data;
  const first = nextData.publicHealthInfectiousReportingCases[0];
  const second = structuredClone(first);
  second.id = `${first.id}-second`;
  second.externalEventId = "external-event-second";
  second.publicHealthEventId = "public-health-event-second";
  second.reportId = "report-second";
  second.event.externalEventId = second.externalEventId;
  second.event.publicHealthEventId = second.publicHealthEventId;
  second.draftReport.reportId = second.reportId;
  second.reportCard.reportId = second.reportId;
  nextData.publicHealthInfectiousReportingCases = [first, second];
  row.replaceData(nextData);

  const timestamp = String(CALLBACK_NOW);
  const nonce = "cdc-cross-case-nonce-001";
  const callback = async (targetCaseId, payload) => request(
    row,
    "POST",
    `/api/public-health/infectious-reporting-cases/${encodeURIComponent(targetCaseId)}/direct-report-callback`,
    payload,
    {
      "x-public-health-direct-report-timestamp": timestamp,
      "x-public-health-direct-report-nonce": nonce,
      "x-public-health-direct-report-signature": signDirectReportCallback(payload, {
        secret: CALLBACK_SECRET,
        timestamp,
        nonce
      })
    }
  );
  const firstReceipt = await callback(caseId, {
    eventId: first.externalEventId,
    receiptId: "cdc-cross-case-receipt-first",
    status: "accepted",
    occurredAt: "2026-08-05T07:59:00.000Z"
  });
  assert.equal(firstReceipt.status, 200);

  const replay = await callback(second.id, {
    eventId: second.externalEventId,
    receiptId: "cdc-cross-case-receipt-second",
    status: "accepted",
    occurredAt: "2026-08-05T07:59:30.000Z"
  });
  assert.equal(replay.status, 409);
  assert.equal(replay.body.code, "PUBLIC_HEALTH_DIRECT_REPORT_CALLBACK_NONCE_REPLAY");
  assert.equal(row.data.publicHealthInfectiousReportingCases[1].state, "submitted");
});
