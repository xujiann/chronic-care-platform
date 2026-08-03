"use strict";

const { createHmac } = require("node:crypto");
const assert = require("node:assert/strict");
const test = require("node:test");
const Delivery = require("../src/http/routes/t06-emergency-signal-delivery");
const Transport = require("../src/clinical-specialties/emergency-signal-delivery-transport");
const Worker = require("../src/clinical-specialties/emergency-signal-delivery-worker");

const SECRET = "0123456789abcdef0123456789abcdef";

function transportEnv(overrides = {}) {
  return {
    NODE_ENV: "production",
    EMERGENCY_SIGNAL_DELIVERY_URL: "https://emergency.example.test/events",
    EMERGENCY_SIGNAL_DELIVERY_SECRET: SECRET,
    EMERGENCY_SIGNAL_TRANSPORT_EVIDENCE_ID: "transport-evidence-001",
    EMERGENCY_SIGNAL_SIGNING_KEY_EVIDENCE_ID: "signing-key-evidence-001",
    EMERGENCY_SIGNAL_RECEIPT_VERIFIER_EVIDENCE_ID: "receipt-verifier-evidence-001",
    ...overrides
  };
}

function event() {
  return {
    id: "event-transport-001",
    action: "domain-event-outbox",
    owner: "clinical-specialties",
    domain: "clinical-specialties",
    type: "clinical-specialties.emergency-signal-updated.v1",
    aggregateId: "signal-transport-001",
    aggregateVersion: 3,
    correlationId: "correlation-transport-001",
    causationId: "command-transport-001",
    occurredAt: "2030-08-04T03:00:00.000Z",
    payload: {
      signalId: "signal-transport-001",
      previousStatus: "pending_acknowledgement",
      status: "acknowledged",
      action: "physician notified",
      level: "high",
      ownerRole: "county"
    }
  };
}

test("transport configuration is fail-closed and never serializes the secret", async () => {
  const config = Transport.emergencySignalTransportConfig(transportEnv());
  assert.equal(config.configured, true);
  assert.equal(config.productionReady, false);
  assert.equal(config.secret, SECRET);
  assert.doesNotMatch(JSON.stringify(config), new RegExp(SECRET));

  const embeddedSecret = Transport.emergencySignalTransportConfig(transportEnv({
    EMERGENCY_SIGNAL_DELIVERY_URL: "https://user:password@emergency.example.test/events?token=private"
  }));
  assert.equal(embeddedSecret.requirements.endpoint, false);
  assert.doesNotMatch(JSON.stringify(embeddedSecret), /password|token=private/);

  const insecure = Transport.emergencySignalTransportConfig(transportEnv({
    EMERGENCY_SIGNAL_DELIVERY_URL: "http://emergency.example.test/events"
  }));
  assert.equal(insecure.requirements.https, false);
  await assert.rejects(
    () => Transport.createEmergencySignalSignedTransport({
      config: insecure,
      fetchImpl: async () => ({ ok: true })
    })(event(), {
      payloadDigest: "sha256:payload",
      attempt: 1,
      generation: 1,
      workerId: "worker"
    }),
    (error) => error.code === "EMERGENCY_SIGNAL_TRANSPORT_HTTPS_REQUIRED"
  );
});

test("signed transport requires a payload-bound HMAC receipt", async () => {
  let request;
  const send = Transport.createEmergencySignalSignedTransport({
    env: transportEnv(),
    now: (() => {
      const values = [
        "2030-08-04T03:00:01.000Z",
        "2030-08-04T03:00:02.000Z"
      ];
      return () => values.shift();
    })(),
    fetchImpl: async (_url, options) => {
      request = options;
      const envelope = JSON.parse(options.body);
      const receipt = {
        requestId: envelope.requestId,
        requestNonce: envelope.requestNonce,
        eventId: envelope.eventId,
        payloadDigest: envelope.payloadDigest,
        generation: envelope.generation,
        attempt: envelope.attempt,
        sentAt: envelope.sentAt,
        providerMessageId: "provider-transport-001",
        status: "delivered",
        occurredAt: "2030-08-04T03:00:01.500Z"
      };
      const signature = createHmac("sha256", SECRET)
        .update(Delivery.stableStringify(receipt))
        .digest("hex");
      return {
        ok: true,
        async text() {
          return JSON.stringify({ ...receipt, signature });
        }
      };
    }
  });
  const receipt = await send(event(), {
    payloadDigest: "sha256:payload-digest",
    attempt: 2,
    generation: 3,
    workerId: "worker-signed"
  });
  assert.equal(receipt.transportVerified, true);
  assert.equal(receipt.signatureVerified, true);
  assert.equal(receipt.eventId, event().id);
  assert.match(request.headers["x-emergency-signature"], /^[a-f0-9]{64}$/);
  assert.equal(request.headers["idempotency-key"], `${event().id}:3`);
  assert.match(request.headers["x-emergency-request-nonce"], /^[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(request.headers, "authorization"), false);
});

test("unsigned or payload-drifted receipts are rejected", async () => {
  const envelope = Transport.deliveryEnvelope(event(), {
    payloadDigest: "sha256:payload-digest",
    attempt: 1,
    generation: 1,
    workerId: "worker"
  }, "2030-08-04T03:00:00.000Z", SECRET);
  assert.throws(
    () => Transport.verifyReceipt({
      requestId: envelope.requestId,
      requestNonce: envelope.requestNonce,
      eventId: envelope.eventId,
      payloadDigest: envelope.payloadDigest,
      generation: envelope.generation,
      attempt: envelope.attempt,
      sentAt: envelope.sentAt,
      providerMessageId: "provider-1",
      status: "delivered",
      occurredAt: "2030-08-04T03:00:01.000Z"
    }, envelope, SECRET, "2030-08-04T03:00:02.000Z"),
    (error) => error.code === "EMERGENCY_SIGNAL_TRANSPORT_RECEIPT_SIGNATURE_REQUIRED"
  );
  const drift = {
    requestId: envelope.requestId,
    requestNonce: envelope.requestNonce,
    eventId: envelope.eventId,
    payloadDigest: "sha256:drift",
    generation: envelope.generation,
    attempt: envelope.attempt,
    sentAt: envelope.sentAt,
    providerMessageId: "provider-1",
    status: "delivered",
    occurredAt: "2030-08-04T03:00:01.000Z"
  };
  drift.signature = createHmac("sha256", SECRET)
    .update(Delivery.stableStringify(drift))
    .digest("hex");
  assert.throws(
    () => Transport.verifyReceipt(
      drift,
      envelope,
      SECRET,
      "2030-08-04T03:00:02.000Z"
    ),
    (error) => error.code === "EMERGENCY_SIGNAL_TRANSPORT_RECEIPT_BINDING_INVALID"
  );

  const previousAttempt = {
    ...Transport.signedReceiptPayload({
      requestId: envelope.requestId,
      requestNonce: envelope.requestNonce,
      eventId: envelope.eventId,
      payloadDigest: envelope.payloadDigest,
      generation: envelope.generation,
      attempt: envelope.attempt - 1,
      sentAt: envelope.sentAt,
      providerMessageId: "provider-1",
      status: "delivered",
      occurredAt: "2030-08-04T03:00:01.000Z"
    })
  };
  previousAttempt.signature = createHmac("sha256", SECRET)
    .update(Delivery.stableStringify(previousAttempt))
    .digest("hex");
  assert.throws(
    () => Transport.verifyReceipt(
      previousAttempt,
      envelope,
      SECRET,
      "2030-08-04T03:00:02.000Z"
    ),
    (error) => error.code === "EMERGENCY_SIGNAL_TRANSPORT_RECEIPT_BINDING_INVALID"
  );
});

test("worker publishes verified receipts and exposes only operational metadata", async () => {
  const claim = {
    eventId: event().id,
    attempt: 1,
    generation: 1,
    workerId: "worker-production",
    leaseToken: "private-lease-token",
    payloadDigest: "sha256:payload-digest",
    event: event()
  };
  let acknowledged;
  let claimOptions;
  const repository = {
    async claim(options) {
      claimOptions = options;
      return [claim];
    },
    async acknowledge(receivedClaim, receipt) {
      acknowledged = { receivedClaim, receipt };
      return { status: "published", duplicate: false };
    },
    async fail() {
      throw new Error("fail must not run");
    }
  };
  const result = await Worker.runEmergencySignalDeliveryWorkerOnce({
    repository,
    workerId: "worker-production",
    runId: "run-private-001",
    now: () => "2030-08-04T04:00:00.000Z",
    transport: async () => ({
      status: "delivered",
      providerMessageId: "provider-worker-001",
      eventId: claim.eventId,
      payloadDigest: claim.payloadDigest,
      receivedAt: "2030-08-04T04:00:01.000Z",
      transportVerified: true,
      signatureVerified: true
    })
  });
  assert.equal(acknowledged.receivedClaim.leaseToken, "private-lease-token");
  assert.equal(claimOptions.limit, 1);
  assert.equal(claimOptions.leaseMs >= 60_000, true);
  assert.equal(result.summary.published, 1);
  assert.equal(result.productionReady, false);
  assert.equal(result.payloadsExposed, false);
  assert.equal(result.leaseTokensExposed, false);
  assert.doesNotMatch(JSON.stringify(result), /private-lease-token|signalId|provider-worker/);
});

test("transport failure is retried, but acknowledgement conflicts are never rewritten as failures", async () => {
  const claim = {
    eventId: event().id,
    attempt: 1,
    generation: 1,
    workerId: "worker-a",
    leaseToken: "lease-a",
    payloadDigest: "sha256:payload",
    event: event()
  };
  let failures = 0;
  const retryRepository = {
    async claim() { return [claim]; },
    async acknowledge() { throw new Error("must not acknowledge"); },
    async fail(_claim, failure) {
      failures += 1;
      assert.equal(failure.errorCode, "TRANSPORT_DOWN");
      return { status: "pending" };
    }
  };
  const retry = await Worker.runEmergencySignalDeliveryWorkerOnce({
    repository: retryRepository,
    workerId: "worker-a",
    now: () => "2030-08-04T05:00:00.000Z",
    transport: async () => {
      throw Object.assign(new Error("private endpoint diagnostic"), {
        code: "TRANSPORT_DOWN"
      });
    }
  });
  assert.equal(failures, 1);
  assert.equal(retry.summary.retrying, 1);
  assert.doesNotMatch(JSON.stringify(retry), /private endpoint diagnostic/);

  failures = 0;
  const staleRepository = {
    async claim() { return [claim]; },
    async acknowledge() {
      throw Object.assign(new Error("stale lease"), {
        code: "EMERGENCY_SIGNAL_DELIVERY_LEASE_CONFLICT"
      });
    },
    async fail() {
      failures += 1;
    }
  };
  await assert.rejects(
    () => Worker.runEmergencySignalDeliveryWorkerOnce({
      repository: staleRepository,
      workerId: "worker-a",
      transport: async () => ({
        status: "delivered",
        providerMessageId: "provider",
        eventId: claim.eventId,
        payloadDigest: claim.payloadDigest,
        receivedAt: "2030-08-04T05:00:01.000Z",
        transportVerified: true,
        signatureVerified: true
      })
    }),
    (error) => error.code === "EMERGENCY_SIGNAL_DELIVERY_LEASE_CONFLICT"
  );
  assert.equal(failures, 0);
});
