"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  ACTIVATION_SCHEMA,
  FOLLOWUP_EVENT_TYPE,
  PUBLISHER_SCHEMA,
  buildFollowupEventPublisherConfig,
  createFollowupEventPublisher,
  createSignedFollowupEventPublisher,
  hmac,
  sha256
} = require("../src/citizen-chronic/followup-event-publisher");
const {
  RUNTIME_FIELD,
  dispatchPendingFollowupEventsToState,
  updateFollowupToState
} = require("../citizen-chronic-followup-event-service");
const { createRouteSegments } = require("../src/http/routes/citizen-chronic");

const SECRET = "citizen-chronic-followup-publisher-secret-32-characters";
const NOW = "2030-08-21T02:00:00.000Z";
const ENV = Object.freeze({
  NODE_ENV: "production",
  CITIZEN_CHRONIC_FOLLOWUP_PUBLISHER_URL: "https://followup-gateway.example.test/events",
  CITIZEN_CHRONIC_FOLLOWUP_PUBLISHER_HMAC_SECRET: SECRET
});
const PUBLIC_RESOLVER = async () => [{ address: "93.184.216.34", family: 4 }];

function eventEnvelope(overrides = {}) {
  return {
    eventId: "followup-event-publisher-001",
    eventType: FOLLOWUP_EVENT_TYPE,
    eventVersion: 1,
    correlationId: "followup-correlation-publisher-001",
    payload: {
      followupId: "followup-001",
      status: "completed",
      updatedAt: "2030-08-21T01:59:00.000Z",
      version: 3
    },
    ...overrides
  };
}

function signedReceipt(envelope, overrides = {}) {
  const binding = {
    requestId: envelope.requestId,
    requestNonce: envelope.requestNonce,
    eventId: envelope.eventId,
    eventType: envelope.eventType,
    eventVersion: envelope.eventVersion,
    correlationId: envelope.correlationId,
    payloadDigest: envelope.payloadDigest,
    sentAt: envelope.sentAt,
    receiptId: `provider-receipt:${envelope.eventId}`,
    status: "accepted",
    occurredAt: envelope.sentAt,
    ...overrides
  };
  return { ...binding, signature: hmac(SECRET, binding) };
}

function jsonResponse(body, options = {}) {
  return {
    ok: options.ok !== false,
    status: options.status || 200,
    redirected: options.redirected === true,
    url: options.url || "",
    headers: {
      get(name) {
        return String(name).toLowerCase() === "content-length"
          ? (options.contentLength ?? null)
          : null;
      }
    },
    async text() {
      return typeof body === "string" ? body : JSON.stringify(body);
    }
  };
}

function activationVerifier(options = {}) {
  const calls = options.calls || [];
  return {
    async verify(request) {
      calls.push(request);
      if (options.throwError) throw new Error("private activation diagnostic");
      return {
        schema: ACTIVATION_SCHEMA,
        contractId: request.contractId,
        endpointDigest: request.endpointDigest,
        eventId: request.eventId,
        payloadDigest: request.payloadDigest,
        activationId: "activation-followup-001",
        evidenceDigest: `sha256:${"a".repeat(64)}`,
        verifiedAt: request.requestedAt,
        validUntil: "2030-08-22T02:00:00.000Z",
        authorized: options.authorized !== false,
        ...(options.overrides || {})
      };
    }
  };
}

function signedPublisher(options = {}) {
  return createSignedFollowupEventPublisher({
    activationVerifier: options.activationVerifier || activationVerifier(),
    env: options.env || ENV,
    fetchImpl: options.fetchImpl,
    now: options.now || (() => NOW),
    resolveAddresses: options.resolveAddresses || PUBLIC_RESOLVER
  });
}

function sourceState(count = 1) {
  return {
    residents: Array.from({ length: count }, (_value, index) => ({
      id: `resident-${index + 1}`,
      orgCode: index === 0 ? "ORG-A" : "ORG-B"
    })),
    followups: Array.from({ length: count }, (_value, index) => ({
      id: `followup-${index + 1}`,
      residentId: `resident-${index + 1}`,
      status: "pending"
    })),
    securityEvents: []
  };
}

async function stagedState(count = 1) {
  let data = sourceState(count);
  const events = [];
  for (let index = 0; index < count; index += 1) {
    const result = await updateFollowupToState(data, {
      id: `followup-${index + 1}`,
      patch: { status: "completed" },
      idempotencyKey: `followup-publisher-command-${index + 1}`,
      correlationId: `followup-correlation-publisher-${index + 1}`,
      at: "2030-08-21T01:59:00.000Z",
      user: { name: "Institution Operator", role: "institution" }
    });
    data = result.nextData;
    events.push(result.event);
  }
  return { nextData: data, events };
}

test("configuration forbids unsafe URLs, loopback/private targets and uncontrolled ports", () => {
  for (const [url, code] of [
    ["http://followup.example.test/events", "FOLLOWUP_EVENT_PUBLISHER_HTTPS_REQUIRED"],
    ["https://user:password@followup.example.test/events", "FOLLOWUP_EVENT_PUBLISHER_ENDPOINT_CREDENTIALS_FORBIDDEN"],
    ["https://followup.example.test/events?token=secret", "FOLLOWUP_EVENT_PUBLISHER_ENDPOINT_COMPONENTS_FORBIDDEN"],
    ["https://followup.example.test/events#secret", "FOLLOWUP_EVENT_PUBLISHER_ENDPOINT_COMPONENTS_FORBIDDEN"],
    ["https://followup.example.test:8443/events", "FOLLOWUP_EVENT_PUBLISHER_PORT_FORBIDDEN"],
    ["https://localhost/events", "FOLLOWUP_EVENT_PUBLISHER_TARGET_FORBIDDEN"],
    ["https://127.0.0.1/events", "FOLLOWUP_EVENT_PUBLISHER_TARGET_FORBIDDEN"],
    ["https://10.10.1.2/events", "FOLLOWUP_EVENT_PUBLISHER_TARGET_FORBIDDEN"],
    ["https://169.254.10.1/events", "FOLLOWUP_EVENT_PUBLISHER_TARGET_FORBIDDEN"],
    ["https://[::1]/events", "FOLLOWUP_EVENT_PUBLISHER_TARGET_FORBIDDEN"]
  ]) {
    assert.throws(
      () => buildFollowupEventPublisherConfig({
        ...ENV,
        CITIZEN_CHRONIC_FOLLOWUP_PUBLISHER_URL: url
      }),
      (error) => error.code === code
    );
  }
  assert.throws(
    () => buildFollowupEventPublisherConfig({
      ...ENV,
      CITIZEN_CHRONIC_FOLLOWUP_PUBLISHER_HMAC_SECRET: "short"
    }),
    (error) => error.code === "FOLLOWUP_EVENT_PUBLISHER_SECRET_UNAVAILABLE"
  );
  const config = buildFollowupEventPublisherConfig(ENV);
  assert.equal(config.productionReady, false);
  assert.equal(config.secret, SECRET);
  assert.match(config.endpointDigest, /^sha256:[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(config), new RegExp(SECRET));

  let fetchCalls = 0;
  const privateDns = signedPublisher({
    resolveAddresses: async () => [{ address: "192.168.1.20", family: 4 }],
    fetchImpl: async () => { fetchCalls += 1; }
  });
  return assert.rejects(
    () => privateDns.publish(eventEnvelope()),
    (error) => error.code === "FOLLOWUP_EVENT_PUBLISHER_TARGET_FORBIDDEN"
  ).then(() => assert.equal(fetchCalls, 0));
});

test("production activation requires an independently injected verifier and cannot be proven by environment flags", async () => {
  let fetchCalls = 0;
  const withoutVerifier = createSignedFollowupEventPublisher({
    env: {
      ...ENV,
      CITIZEN_CHRONIC_FOLLOWUP_PUBLISHER_ACTIVATED: "true",
      CITIZEN_CHRONIC_FOLLOWUP_PUBLISHER_EVIDENCE_ID: "environment-is-not-evidence"
    },
    fetchImpl: async () => { fetchCalls += 1; },
    now: () => NOW,
    resolveAddresses: PUBLIC_RESOLVER
  });
  await assert.rejects(
    () => withoutVerifier.publish(eventEnvelope()),
    (error) => error.code === "FOLLOWUP_EVENT_PUBLISHER_ACTIVATION_VERIFIER_REQUIRED"
  );
  assert.equal(fetchCalls, 0);

  const denied = signedPublisher({
    activationVerifier: activationVerifier({ authorized: false }),
    fetchImpl: async () => { fetchCalls += 1; }
  });
  await assert.rejects(
    () => denied.publish(eventEnvelope()),
    (error) => error.code === "FOLLOWUP_EVENT_PUBLISHER_ACTIVATION_DENIED"
  );
  assert.equal(fetchCalls, 0);

  const failed = signedPublisher({
    activationVerifier: activationVerifier({ throwError: true }),
    fetchImpl: async () => { fetchCalls += 1; }
  });
  await assert.rejects(
    () => failed.publish(eventEnvelope()),
    (error) => error.code === "FOLLOWUP_EVENT_PUBLISHER_ACTIVATION_VERIFICATION_FAILED"
      && !error.message.includes("private activation diagnostic")
  );
  assert.equal(fetchCalls, 0);
});

test("stable event and payload binding revalidates an exact idempotent provider receipt", async () => {
  const times = [
    "2030-08-21T02:00:00.000Z",
    "2030-08-21T02:00:01.000Z",
    "2030-08-21T02:10:00.000Z",
    "2030-08-21T02:10:01.000Z"
  ];
  const requests = [];
  let firstReceipt;
  const publisher = signedPublisher({
    now: () => times.shift(),
    fetchImpl: async (url, options) => {
      const envelope = JSON.parse(options.body);
      requests.push({ url, options, envelope });
      if (!firstReceipt) firstReceipt = signedReceipt(envelope);
      return jsonResponse(firstReceipt);
    }
  });

  const first = await publisher.publish(eventEnvelope());
  const replay = await publisher.publish(eventEnvelope());
  assert.equal(first.receiptId, replay.receiptId);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].envelope.requestId, requests[1].envelope.requestId);
  assert.equal(requests[0].envelope.requestNonce, requests[1].envelope.requestNonce);
  assert.equal(requests[0].options.headers["idempotency-key"], requests[0].envelope.requestId);
  assert.equal(requests[1].options.headers["idempotency-key"], requests[0].envelope.requestId);
  assert.notEqual(requests[0].envelope.sentAt, requests[1].envelope.sentAt);
  assert.equal(requests[0].options.redirect, "error");
  assert.deepEqual(Object.keys(requests[0].envelope.payload).sort(), ["followupId", "status", "updatedAt", "version"]);
  assert.match(first.requestBindingDigest, /^sha256:[a-f0-9]{64}$/);
  assert.match(first.receiptBindingDigest, /^sha256:[a-f0-9]{64}$/);
  assert.match(first.providerReceiptDigest, /^sha256:[a-f0-9]{64}$/);
  assert.match(first.signatureDigest, /^sha256:[a-f0-9]{64}$/);
  assert.match(first.activationDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(first.productionReady, false);
});

test("signed receipt binding, signature and time-window drift fail closed", async () => {
  async function rejectsReceipt(overrides, code) {
    const publisher = signedPublisher({
      env: { ...ENV, CITIZEN_CHRONIC_FOLLOWUP_PUBLISHER_RECEIPT_MAX_SKEW_SECONDS: "30" },
      fetchImpl: async (_url, options) => {
        const envelope = JSON.parse(options.body);
        return jsonResponse(signedReceipt(envelope, overrides));
      }
    });
    await assert.rejects(() => publisher.publish(eventEnvelope()), (error) => error.code === code);
  }
  for (const drift of [
    { eventId: "another-event" },
    { eventVersion: 2 },
    { correlationId: "another-correlation" },
    { payloadDigest: "0".repeat(64) }
  ]) {
    await rejectsReceipt(drift, "FOLLOWUP_EVENT_PUBLISHER_RECEIPT_BINDING_INVALID");
  }
  await rejectsReceipt(
    { occurredAt: "2030-08-21T02:02:00.000Z" },
    "FOLLOWUP_EVENT_PUBLISHER_RECEIPT_TIME_WINDOW_INVALID"
  );

  const unsigned = signedPublisher({
    fetchImpl: async (_url, options) => {
      const receipt = signedReceipt(JSON.parse(options.body));
      delete receipt.signature;
      return jsonResponse(receipt);
    }
  });
  await assert.rejects(
    () => unsigned.publish(eventEnvelope()),
    (error) => error.code === "FOLLOWUP_EVENT_PUBLISHER_RECEIPT_SIGNATURE_REQUIRED"
  );

  const forged = signedPublisher({
    fetchImpl: async (_url, options) => jsonResponse({
      ...signedReceipt(JSON.parse(options.body)),
      signature: "0".repeat(64)
    })
  });
  await assert.rejects(
    () => forged.publish(eventEnvelope()),
    (error) => error.code === "FOLLOWUP_EVENT_PUBLISHER_RECEIPT_SIGNATURE_INVALID"
  );
});

test("timeout, oversized response, provider rejection and redirect expose only stable errors", async () => {
  const cases = [
    {
      code: "FOLLOWUP_EVENT_PUBLISHER_TIMEOUT",
      fetchImpl: async () => {
        const error = new Error("private network diagnostic");
        error.name = "AbortError";
        throw error;
      }
    },
    {
      code: "FOLLOWUP_EVENT_PUBLISHER_RECEIPT_TOO_LARGE",
      fetchImpl: async () => jsonResponse("x".repeat(16_385))
    },
    {
      code: "FOLLOWUP_EVENT_PUBLISHER_PROVIDER_REJECTED",
      fetchImpl: async () => jsonResponse({ privateDiagnostic: "do not expose" }, { ok: false, status: 503 })
    },
    {
      code: "FOLLOWUP_EVENT_PUBLISHER_REDIRECT_FORBIDDEN",
      fetchImpl: async () => jsonResponse({}, {
        redirected: true,
        url: "https://redirected.example.test/events"
      })
    }
  ];
  for (const candidate of cases) {
    await assert.rejects(
      () => signedPublisher({ fetchImpl: candidate.fetchImpl }).publish(eventEnvelope()),
      (error) => error.code === candidate.code
        && !/private network diagnostic|privateDiagnostic|redirected\.example/.test(error.message)
    );
  }
});

test("local compatibility remains while production rejects unbranded publisher booleans", async () => {
  const local = createFollowupEventPublisher({ env: { NODE_ENV: "test" } });
  assert.deepEqual(await local.publish(eventEnvelope()), {
    accepted: true,
    receiptId: `local-followup-receipt:${eventEnvelope().eventId}`,
    status: "accepted",
    simulated: true,
    productionReady: false
  });

  const staged = await stagedState();
  const before = structuredClone(staged.nextData);
  await assert.rejects(
    () => dispatchPendingFollowupEventsToState(staged.nextData, {
      environment: "production",
      publisher: {
        async publish(envelope) {
          return {
            accepted: true,
            receiptId: `forged:${envelope.eventId}`,
            status: "delivered",
            transportVerified: true,
            signatureVerified: true
          };
        }
      }
    }),
    (error) => error.code === "FOLLOWUP_EVENT_PUBLISHER_RECEIPT_UNVERIFIED"
  );
  assert.deepEqual(staged.nextData, before);

  const noActivation = createSignedFollowupEventPublisher({
    env: ENV,
    fetchImpl: async () => { throw new Error("must not reach provider"); },
    now: () => NOW,
    resolveAddresses: PUBLIC_RESOLVER
  });
  await assert.rejects(
    () => dispatchPendingFollowupEventsToState(staged.nextData, {
      environment: "production",
      publisher: noActivation
    }),
    (error) => error.code === "FOLLOWUP_EVENT_PUBLISHER_ACTIVATION_VERIFIER_REQUIRED"
  );
  assert.deepEqual(staged.nextData, before);
  assert.equal(staged.nextData.followups[0][RUNTIME_FIELD].outbox[0].deliveryState, "pending");
});

test("batch middle failure rolls back local state and exact receipts make the retry safe", async () => {
  const staged = await stagedState(2);
  const before = structuredClone(staged.nextData);
  const receipts = new Map();
  const idempotencyKeys = [];
  let failSecond = true;
  const publisher = signedPublisher({
    fetchImpl: async (_url, options) => {
      const envelope = JSON.parse(options.body);
      idempotencyKeys.push(options.headers["idempotency-key"]);
      if (envelope.payload.followupId === "followup-2" && failSecond) {
        failSecond = false;
        return jsonResponse({}, { ok: false, status: 503 });
      }
      if (!receipts.has(envelope.requestId)) {
        receipts.set(envelope.requestId, signedReceipt(envelope, {
          status: envelope.payload.followupId === "followup-2" ? "delivered" : "accepted"
        }));
      }
      return jsonResponse(receipts.get(envelope.requestId));
    }
  });

  await assert.rejects(
    () => dispatchPendingFollowupEventsToState(staged.nextData, {
      environment: "production",
      publisher
    }),
    (error) => error.code === "FOLLOWUP_EVENT_PUBLISHER_PROVIDER_REJECTED"
  );
  assert.deepEqual(staged.nextData, before);
  assert.equal(staged.nextData.followups.every((item) => item[RUNTIME_FIELD].outbox[0].deliveryState === "pending"), true);

  const retried = await dispatchPendingFollowupEventsToState(staged.nextData, {
    environment: "production",
    publisher
  });
  assert.equal(retried.processed.length, 2);
  assert.equal(retried.health.summary.acceptedReceipts, 1);
  assert.equal(retried.health.summary.deliveredReceipts, 1);
  assert.equal(idempotencyKeys[0], idempotencyKeys[2]);
  const evidence = retried.nextData.followups.flatMap((item) => item[RUNTIME_FIELD].receipts);
  assert.deepEqual(evidence.map((item) => item.deliveryStatus).sort(), ["accepted", "delivered"]);
  evidence.forEach((item) => {
    assert.match(item.requestBindingDigest, /^sha256:[a-f0-9]{64}$/);
    assert.match(item.receiptBindingDigest, /^sha256:[a-f0-9]{64}$/);
    assert.match(item.signatureDigest, /^sha256:[a-f0-9]{64}$/);
    assert.equal(Object.hasOwn(item, "receiptId"), false);
  });
});

test("concurrent dispatches coalesce in one process and retain stable cross-process idempotency", async () => {
  const staged = await stagedState();
  const dispatchAt = "2030-08-21T02:01:00.000Z";
  let fetchCalls = 0;
  const publisher = signedPublisher({
    fetchImpl: async (_url, options) => {
      fetchCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return jsonResponse(signedReceipt(JSON.parse(options.body), { status: "delivered" }));
    }
  });
  const [left, right] = await Promise.all([
    dispatchPendingFollowupEventsToState(staged.nextData, { at: dispatchAt, environment: "production", publisher }),
    dispatchPendingFollowupEventsToState(staged.nextData, { at: dispatchAt, environment: "production", publisher })
  ]);
  assert.equal(fetchCalls, 1);
  assert.equal(left.nextData.followups[0][RUNTIME_FIELD].outbox[0].deliveryState, "published");
  assert.deepEqual(left.nextData, right.nextData);
  assert.equal(staged.nextData.followups[0][RUNTIME_FIELD].outbox[0].deliveryState, "pending");
});

test("institution dispatch filters resident and organization scope before publisher invocation and audits outcomes", async () => {
  const staged = await stagedState(2);
  let persisted = staged.nextData;
  let publisherCalls = 0;
  const audits = [];
  const baseRuntime = {
    appendSecurityEvent: (event) => audits.push(event),
    canAccessResident: (_user, residentId) => residentId === "resident-1",
    rowMatchesOrganizationScope: () => true,
    readDatabase: () => persisted,
    readFollowupDispatchOutboxHealth: () => ({ counts: { pending: 2 }, healthy: true, durableStorageAvailable: true, requestPathExternalDispatch: false, productionReady: false }),
    requireApiRole: () => ({ name: "Institution A", role: "institution", orgCode: "ORG-A" }),
    sendJson(res, statusCode, body) {
      res.statusCode = statusCode;
      res.body = body;
    },
    writeDatabase: (next) => { persisted = next; }
  };
  const scopedPublisher = {
    async publish(envelope) {
      publisherCalls += 1;
      return { accepted: true, receiptId: `local:${envelope.eventId}`, status: "accepted" };
    }
  };
  const segment = createRouteSegments(baseRuntime, {
    env: { NODE_ENV: "test" },
    followupEventPublisher: scopedPublisher
  }).find((candidate) => candidate.id === "citizen-chronic-06");
  const response = {};
  await segment.handle(
    { method: "POST", headers: {} },
    response,
    new URL("https://platform.example.test/api/chronic/followup-events/dispatch")
  );
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.processed.length, 0);
  assert.equal(response.body.queued, 1);
  assert.equal(response.body.requestPathExternalDispatch, false);
  assert.equal(publisherCalls, 0);
  assert.equal(persisted.followups[0][RUNTIME_FIELD].outbox[0].deliveryState, "pending");
  assert.equal(persisted.followups[1][RUNTIME_FIELD].outbox[0].deliveryState, "pending");
  assert.equal(audits.at(-1).result, "allowed");

  publisherCalls = 0;
  const deniedResponse = {};
  const deniedSegment = createRouteSegments({
    ...baseRuntime,
    canAccessResident: () => false
  }, {
    env: { NODE_ENV: "test" },
    followupEventPublisher: scopedPublisher
  }).find((candidate) => candidate.id === "citizen-chronic-06");
  await deniedSegment.handle(
    { method: "POST", headers: {} },
    deniedResponse,
    new URL("https://platform.example.test/api/chronic/followup-events/dispatch")
  );
  assert.equal(deniedResponse.statusCode, 403);
  assert.equal(deniedResponse.body.code, "FOLLOWUP_EVENT_DISPATCH_RESIDENT_SCOPE_DENIED");
  assert.equal(publisherCalls, 0);
  assert.equal(audits.at(-1).result, "denied");

  let reads = 0;
  const missingOrgResponse = {};
  const missingOrgSegment = createRouteSegments({
    ...baseRuntime,
    readDatabase: () => { reads += 1; return persisted; },
    requireApiRole: () => ({ name: "Unbound Institution", role: "institution", orgCode: "" })
  }, {
    env: { NODE_ENV: "test" },
    followupEventPublisher: scopedPublisher
  }).find((candidate) => candidate.id === "citizen-chronic-06");
  await missingOrgSegment.handle(
    { method: "POST", headers: {} },
    missingOrgResponse,
    new URL("https://platform.example.test/api/chronic/followup-events/dispatch")
  );
  assert.equal(missingOrgResponse.statusCode, 403);
  assert.equal(reads, 0);
  assert.equal(publisherCalls, 0);

  const unavailableAudits = [];
  const unavailableResponse = {};
  const unavailableSegment = createRouteSegments({
    ...baseRuntime,
    appendSecurityEvent: (event) => unavailableAudits.push(event),
    readFollowupDispatchOutboxHealth: () => ({
      counts: { pending: 0 },
      healthy: false,
      durableStorageAvailable: false,
      requestPathExternalDispatch: false,
      productionReady: false
    })
  }, {
    env: { NODE_ENV: "test" },
    followupEventPublisher: scopedPublisher
  }).find((candidate) => candidate.id === "citizen-chronic-06");
  await unavailableSegment.handle(
    { method: "POST", headers: {} },
    unavailableResponse,
    new URL("https://platform.example.test/api/chronic/followup-events/dispatch")
  );
  assert.equal(unavailableResponse.statusCode, 503);
  assert.equal(unavailableResponse.body.code, "FOLLOWUP_EVENT_DISPATCH_DURABLE_QUEUE_UNAVAILABLE");
  assert.equal(unavailableResponse.body.accepted, undefined);
  assert.equal(unavailableAudits.some((item) => item.result === "allowed" || item.result === "accepted"), false);
  assert.equal(unavailableAudits.at(-1).result, "denied");
});

test("dispatch request never calls provider or performs a second persistence write", async () => {
  const staged = await stagedState();
  let persisted = staged.nextData;
  const audits = [];
  const idempotencyKeys = [];
  let providerReceipt;
  const publisher = signedPublisher({
    fetchImpl: async (_url, options) => {
      const envelope = JSON.parse(options.body);
      idempotencyKeys.push(options.headers["idempotency-key"]);
      if (!providerReceipt) providerReceipt = signedReceipt(envelope, { status: "delivered" });
      return jsonResponse(providerReceipt);
    }
  });
  const runtime = {
    appendSecurityEvent: (event) => audits.push(event),
    canAccessResident: () => true,
    rowMatchesOrganizationScope: () => true,
    readDatabase: () => persisted,
    readFollowupDispatchOutboxHealth: () => ({ counts: { pending: 1 }, healthy: true, durableStorageAvailable: true, requestPathExternalDispatch: false, productionReady: false }),
    requireApiRole: () => ({ name: "Commission Operator", role: "commission", orgCode: "ORG-COMMISSION" }),
    sendJson(res, statusCode, body) {
      res.statusCode = statusCode;
      res.body = body;
    },
    writeDatabase() { throw new Error("request path must not write delivery results"); }
  };
  const segment = createRouteSegments(runtime, {
    env: ENV,
    followupEventPublisher: publisher,
    followupEventPublisherActivationVerifier: activationVerifier()
  }).find((candidate) => candidate.id === "citizen-chronic-06");

  const accepted = {};
  await segment.handle(
    { method: "POST", headers: {} },
    accepted,
    new URL("https://platform.example.test/api/chronic/followup-events/dispatch")
  );
  assert.equal(accepted.statusCode, 200);
  assert.equal(accepted.body.dispatchMode, "durable-worker");
  assert.equal(accepted.body.requestPathExternalDispatch, false);
  assert.equal(persisted.followups[0][RUNTIME_FIELD].outbox[0].deliveryState, "pending");
  assert.equal(idempotencyKeys.length, 0);
  assert.equal(audits.at(-1).result, "allowed");
});

test("dispatch fails closed before publisher and state write when the authorization audit cannot persist", async () => {
  const staged = await stagedState();
  const before = structuredClone(staged.nextData);
  let publisherCalls = 0;
  let writes = 0;
  const response = {};
  const segment = createRouteSegments({
    appendSecurityEvent() {
      throw new Error("private audit persistence diagnostic");
    },
    canAccessResident: () => true,
    rowMatchesOrganizationScope: () => true,
    readDatabase: () => staged.nextData,
    readFollowupDispatchOutboxHealth: () => ({ counts: { pending: 1 }, healthy: true, durableStorageAvailable: true }),
    requireApiRole: () => ({ name: "Commission Operator", role: "commission" }),
    sendJson(res, statusCode, body) {
      res.statusCode = statusCode;
      res.body = body;
    },
    writeDatabase: () => { writes += 1; }
  }, {
    env: { NODE_ENV: "test" },
    followupEventPublisher: {
      async publish() {
        publisherCalls += 1;
        return { accepted: true, receiptId: "must-not-be-created", status: "accepted" };
      }
    }
  }).find((candidate) => candidate.id === "citizen-chronic-06");

  await segment.handle(
    { method: "POST", headers: {} },
    response,
    new URL("https://platform.example.test/api/chronic/followup-events/dispatch")
  );
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.code, "FOLLOWUP_EVENT_DISPATCH_AUDIT_UNAVAILABLE");
  assert.equal(publisherCalls, 0);
  assert.equal(writes, 0);
  assert.deepEqual(staged.nextData, before);
});

test("production dispatch API queues locally without reaching the unapproved provider", async () => {
  const staged = await stagedState();
  const before = structuredClone(staged.nextData);
  const audits = [];
  let writes = 0;
  const response = {};
  const runtime = {
    appendSecurityEvent: (event) => audits.push(event),
    canAccessResident: () => true,
    rowMatchesOrganizationScope: () => true,
    readDatabase: () => staged.nextData,
    readFollowupDispatchOutboxHealth: () => ({ counts: { pending: 1 }, healthy: true, durableStorageAvailable: true, requestPathExternalDispatch: false, productionReady: false }),
    writeDatabase: () => { writes += 1; },
    requireApiRole: () => ({ name: "Commission Operator", role: "commission" }),
    sendJson(res, statusCode, body) {
      res.statusCode = statusCode;
      res.body = body;
    }
  };
  const segment = createRouteSegments(runtime, {
    env: ENV,
    fetchImpl: async () => { throw new Error("must not reach provider"); },
    resolvePublisherAddresses: PUBLIC_RESOLVER
  }).find((candidate) => candidate.id === "citizen-chronic-06");
  await segment.handle(
    { method: "POST", headers: {} },
    response,
    new URL("https://platform.example.test/api/chronic/followup-events/dispatch")
  );
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.dispatchMode, "durable-worker");
  assert.equal(response.body.requestPathExternalDispatch, false);
  assert.equal(writes, 0);
  assert.equal(audits.at(-1).result, "allowed");
  assert.deepEqual(staged.nextData, before);
});

test("activation request binds the contract, endpoint, event and payload digest", async () => {
  const calls = [];
  const publisher = signedPublisher({
    activationVerifier: activationVerifier({ calls }),
    fetchImpl: async (_url, options) => jsonResponse(signedReceipt(JSON.parse(options.body)))
  });
  await publisher.publish(eventEnvelope());
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    schema: ACTIVATION_SCHEMA,
    contractId: PUBLISHER_SCHEMA,
    endpointDigest: `sha256:${sha256(ENV.CITIZEN_CHRONIC_FOLLOWUP_PUBLISHER_URL)}`,
    eventId: eventEnvelope().eventId,
    payloadDigest: sha256(eventEnvelope().payload),
    requestedAt: NOW
  });
});
