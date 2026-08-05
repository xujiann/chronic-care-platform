"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const sourceData = require("../data/db.json");
const {
  DEFAULT_INFECTIOUS_EVENT_LINK,
  applyInfectiousReportingAction,
  buildInfectiousReportingCaseFromSources,
  upsertInfectiousReportingCase
} = require("../public-health-event-reporting-service");
const {
  createRouteSegment
} = require("../src/http/routes/public-health/infectious-reporting");

function fixture() {
  let data = structuredClone(sourceData);
  data.publicHealthInfectiousReportingCases = [];
  data.securityEvents = [];
  data.dataAccessLogs = [];
  let payload = {};
  let response = null;
  let sequence = 0;
  const runtime = {
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
    randomUUID: () => `runtime-${++sequence}`,
    readDatabase: () => structuredClone(data),
    requireApiRole: () => ({ name: "commission-user", role: "commission" }),
    sealAuditTrail: (rows) => rows,
    sendJson: (_res, status, body) => { response = { status, body }; },
    upsertInfectiousReportingCase,
    writeDatabase: (next) => { data = structuredClone(next); }
  };
  return {
    segment: createRouteSegment(runtime),
    get data() { return structuredClone(data); },
    get response() { return response; },
    setPayload(value) { payload = structuredClone(value); }
  };
}

async function request(row, method, pathname, payload) {
  row.setPayload(payload || {});
  const handled = await row.segment.handle(
    { method },
    {},
    new URL(`http://localhost${pathname}`)
  );
  assert.equal(handled, true);
  return row.response;
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
