"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  COLLECTION,
  DOMAIN,
  EVENT_TYPE,
  OUTBOX_COLLECTION,
  safePatch,
  updateEmergencySignal
} = require("../src/http/routes/t06-emergency-signal-write");
const emergencySignalRoute = require("../src/http/routes/clinical-specialties/emergency-signals");

function runtimeState() {
  return {
    emergencySignals: [{
      id: "signal-1",
      residentId: "resident-1",
      level: "high",
      status: "pending_acknowledgement",
      action: "notify physician"
    }],
    emergencyAuditEvents: [],
    securityEvents: [],
    storageMeta: { collectionVersions: { emergencySignals: 7 } }
  };
}

test("emergency signal update commits owned aggregate and versioned event in one unit of work", async () => {
  let state = runtimeState();
  let writes = 0;
  let writeOptions = null;
  const result = await updateEmergencySignal({
    id: "signal-1",
    payload: {
      expectedVersion: 7,
      id: "tampered-id",
      residentId: "tampered-resident",
      aggregateVersion: 999,
      status: "acknowledged",
      action: "physician notified"
    },
    user: {
      username: "county-duty",
      name: "County Duty",
      role: "county"
    },
    correlationId: "correlation-emergency-001",
    causationId: "command-emergency-001",
    readDatabase: () => structuredClone(state),
    prependAuditTrailEntry: (rows, entry) => [entry, ...rows],
    writeDatabase(data, options) {
      writes += 1;
      state = structuredClone(data);
      writeOptions = structuredClone(options);
    }
  });

  assert.equal(result.status, 200);
  assert.equal(writes, 1);
  assert.equal(result.body.id, "signal-1");
  assert.equal(result.body.residentId, "resident-1");
  assert.equal(result.body.status, "acknowledged");
  assert.equal(result.body.aggregateVersion, 1);
  assert.equal(result.event.type, EVENT_TYPE);
  assert.equal(result.event.domain, DOMAIN);
  assert.equal(result.event.correlationId, "correlation-emergency-001");
  assert.equal(result.event.causationId, "command-emergency-001");
  assert.deepEqual(result.event.payload, {
    signalId: "signal-1",
    previousStatus: "pending_acknowledgement",
    status: "acknowledged",
    action: "physician notified",
    level: "high",
    ownerRole: "county"
  });

  assert.equal(state[COLLECTION][0].aggregateVersion, 1);
  assert.equal(state.storageMeta.collectionVersions.emergencySignals, 7);
  assert.equal(state[OUTBOX_COLLECTION][0].id, result.event.id);
  assert.equal(state[OUTBOX_COLLECTION][0].outboxStatus, "pending");
  assert.equal(state[OUTBOX_COLLECTION][0].owner, DOMAIN);
  assert.equal(state.securityEvents[0].ownershipContract.owner, DOMAIN);
  assert.equal(state.securityEvents[0].ownershipContract.unitOfWork, true);
  assert.equal(state.securityEvents[0].domainEvent.type, EVENT_TYPE);
  assert.deepEqual(writeOptions, {
    event: EVENT_TYPE,
    ownershipContract: {
      collection: COLLECTION,
      owner: DOMAIN,
      repository: "DomainRepository",
      unitOfWork: true
    }
  });
});

test("emergency signal repository does not write or emit an event for missing aggregates", async () => {
  let writes = 0;
  const state = runtimeState();
  const result = await updateEmergencySignal({
    id: "missing",
    payload: { status: "acknowledged" },
    user: { name: "County Duty", role: "county" },
    readDatabase: () => structuredClone(state),
    prependAuditTrailEntry: (rows, entry) => [entry, ...rows],
    writeDatabase: () => { writes += 1; }
  });
  assert.equal(result.status, 404);
  assert.equal(result.event, null);
  assert.equal(writes, 0);
});

test("emergency signal patch protects aggregate identity and repository fields", () => {
  assert.deepEqual(safePatch({
    id: "tampered",
    residentId: "tampered",
    aggregateVersion: 99,
    expectedVersion: 4,
    updatedBy: "tampered",
    status: "dispatched",
    metadata: { channel: "county-command" }
  }), {
    status: "dispatched",
    metadata: { channel: "county-command" }
  });
});

test("emergency signal route exposes ownership and versioned event headers", async () => {
  let state = runtimeState();
  let responseStatus = null;
  let responseBody = null;
  const headers = {};
  const segment = emergencySignalRoute.createRouteSegment({
    collectJson: async () => ({ status: "dispatched" }),
    prependAuditTrailEntry: (rows, entry) => [entry, ...rows],
    readDatabase: () => structuredClone(state),
    requireApiRole: () => ({ username: "hospital-duty", name: "Hospital Duty", role: "institution" }),
    sendJson: (_res, status, body) => {
      responseStatus = status;
      responseBody = body;
    },
    writeDatabase: (data) => { state = structuredClone(data); }
  });
  const handled = await segment.handle(
    {
      method: "PATCH",
      headers: { "idempotency-key": "emergency-command-002" },
      correlationId: "emergency-correlation-002"
    },
    {
      setHeader(name, value) {
        headers[String(name).toLowerCase()] = String(value);
      }
    },
    new URL("http://local/api/emergency-signals/signal-1")
  );
  assert.equal(handled, true);
  assert.equal(responseStatus, 200);
  assert.equal(responseBody.status, "dispatched");
  assert.equal(headers["x-data-owner"], DOMAIN);
  assert.equal(headers["x-domain-event-type"], EVENT_TYPE);
  assert.equal(headers["x-domain-event-id"], state[OUTBOX_COLLECTION][0].id);
});
