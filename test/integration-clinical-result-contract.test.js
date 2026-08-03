"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  EVENT_TYPE,
  PLATFORM_CONTRACT_ID,
  createClinicalResultRegistry,
  receiveClinicalResult
} = require("../src/http/routes/t08-clinical-result-exchange");
const integrationRoutes = require("../src/http/routes/integration");

const LIS_CONTRACT = Object.freeze({
  id: "lis-report-v1",
  domain: "LIS",
  version: "1.0.0",
  requiredFields: ["externalId", "residentId", "item", "result", "reportedAt"]
});

function lisPayload() {
  return {
    contractId: "lis-report-v1",
    idempotencyKey: "lis-result-001",
    externalId: "LIS-RESULT-001",
    residentId: "resident-1",
    item: "HbA1c",
    result: "6.8%",
    reportedAt: "2026-08-03T08:00:00.000Z"
  };
}

function gatewayEvent(payload, contract) {
  return {
    id: "gateway-event-001",
    contractId: contract.id,
    domain: contract.domain,
    idempotencyKey: payload.idempotencyKey,
    externalId: payload.externalId,
    residentId: payload.residentId,
    status: "received",
    reconciliationStatus: "pending"
  };
}

test("clinical result anti-corruption adapter normalizes LIS and PACS payloads", () => {
  const registry = createClinicalResultRegistry();
  assert.deepEqual(registry.decode(PLATFORM_CONTRACT_ID, "integration", lisPayload()), {
    resultId: "LIS-RESULT-001",
    residentId: "resident-1",
    resultType: "laboratory",
    status: "received",
    sourceSystem: "LIS",
    item: "HbA1c",
    result: "6.8%",
    reportedAt: "2026-08-03T08:00:00.000Z"
  });
  assert.deepEqual(registry.decode(PLATFORM_CONTRACT_ID, "integration", {
    contractId: "pacs-report-v1",
    externalId: "PACS-RESULT-001",
    residentId: "resident-2",
    modality: "CT",
    conclusion: "No acute finding",
    reportedAt: "2026-08-03T08:10:00.000Z"
  }), {
    resultId: "PACS-RESULT-001",
    residentId: "resident-2",
    resultType: "imaging",
    status: "received",
    sourceSystem: "PACS",
    item: "CT",
    result: "No acute finding",
    reportedAt: "2026-08-03T08:10:00.000Z"
  });
  assert.throws(
    () => registry.decode(PLATFORM_CONTRACT_ID, "integration", {
      contractId: "lis-report-v1",
      residentId: "resident-1"
    }),
    /missing: resultId/
  );
});

test("clinical result exchange persists inbox, receipt and pending outbox once", async () => {
  const payload = lisPayload();
  const data = { integrationGatewayEvents: [], securityEvents: [] };
  let writes = 0;
  let writeOptions = null;
  const options = {
    data,
    payload,
    contract: LIS_CONTRACT,
    user: { username: "hospital", name: "Hospital Operator", role: "institution" },
    correlationId: "clinical-result-correlation-001",
    normalizeIntegrationEvent: gatewayEvent,
    prependAuditTrailEntry: (rows, entry) => [entry, ...rows],
    writeDatabase(_data, persistedOptions) {
      writes += 1;
      writeOptions = structuredClone(persistedOptions);
    }
  };
  const accepted = await receiveClinicalResult(options);
  assert.equal(accepted.duplicate, false);
  assert.equal(writes, 1);
  assert.equal(accepted.event.platformContractId, PLATFORM_CONTRACT_ID);
  assert.equal(accepted.event.domainEvent.type, EVENT_TYPE);
  assert.equal(accepted.event.domainEvent.correlationId, "clinical-result-correlation-001");
  assert.equal(accepted.event.inbox.status, "completed");
  assert.equal(accepted.event.outbox.status, "pending");
  assert.equal(accepted.receipt.status, "accepted");
  assert.equal(accepted.receipt.productionEvidence, false);
  assert.match(accepted.receipt.canonicalDigest, /^[a-f0-9]{64}$/);
  assert.equal(data.securityEvents[0].antiCorruptionAdapter.contractId, PLATFORM_CONTRACT_ID);
  assert.deepEqual(writeOptions, {
    event: EVENT_TYPE,
    integrationContract: {
      contractId: PLATFORM_CONTRACT_ID,
      externalContractId: "lis-report-v1",
      receiptId: accepted.receipt.id,
      idempotent: true
    }
  });

  const replay = await receiveClinicalResult(options);
  assert.equal(replay.duplicate, true);
  assert.equal(replay.event.id, accepted.event.id);
  assert.equal(replay.event.idempotentReplay, true);
  assert.equal(replay.receipt.id, accepted.receipt.id);
  assert.equal(writes, 1);
  assert.equal(data.integrationGatewayEvents.length, 1);
});

test("signed LIS route returns deterministic receipt and suppresses replay", async () => {
  const payload = lisPayload();
  let state = {
    integrationContracts: [LIS_CONTRACT],
    integrationGatewayEvents: [],
    securityEvents: []
  };
  let writes = 0;
  let responseStatus = null;
  let responseBody = null;
  let responseHeaders = {};
  const segments = integrationRoutes.createRouteSegments({
    collectJson: async () => structuredClone(payload),
    normalizeIntegrationEvent: gatewayEvent,
    prependAuditTrailEntry: (rows, entry) => [entry, ...rows],
    readDatabase: () => structuredClone(state),
    requireApiRole: () => ({ username: "hospital", name: "Hospital Operator", role: "institution" }),
    sendJson: (_res, status, body) => {
      responseStatus = status;
      responseBody = body;
    },
    verifyIntegrationSignature: () => true,
    writeDatabase: (data) => {
      writes += 1;
      state = structuredClone(data);
    }
  });
  const segment = segments[1];
  const request = {
    method: "POST",
    headers: {
      "x-correlation-id": "clinical-result-correlation-002",
      "x-integration-signature": "test-signature"
    }
  };
  const response = {
    setHeader(name, value) {
      responseHeaders[String(name).toLowerCase()] = String(value);
    }
  };
  await segment.handle(request, response, new URL("http://local/api/integration/events"));
  assert.equal(responseStatus, 202);
  assert.equal(writes, 1);
  assert.equal(responseHeaders["x-platform-contract"], PLATFORM_CONTRACT_ID);
  assert.equal(responseHeaders["x-integration-receipt-id"], responseBody.contractReceipt.id);
  const acceptedId = responseBody.id;

  responseHeaders = {};
  await segment.handle(request, response, new URL("http://local/api/integration/events"));
  assert.equal(responseStatus, 200);
  assert.equal(responseBody.id, acceptedId);
  assert.equal(responseBody.idempotentReplay, true);
  assert.equal(writes, 1);
});
