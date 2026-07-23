"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const {
  createSignedDeliveryAdapter,
  stableStringify
} = require("../care-service-delivery-adapters");

const SECRET = "care-service-test-secret-at-least-32-characters";

function event() {
  return {
    id: "event-1",
    aggregateId: "order-1",
    eventType: "internet-nursing-order-created",
    idempotencyKey: "nursing:create:command-1",
    payloadDigest: "a".repeat(64),
    payload: { orderId: "order-1", residentId: "r1" }
  };
}

test("signed delivery adapter binds request and signed receipt without exposing its secret", async () => {
  let request;
  const adapter = createSignedDeliveryAdapter("nursing", {
    env: {
      NODE_ENV: "production",
      CARE_NURSING_DELIVERY_URL: "https://gateway.example.test/care/nursing",
      CARE_NURSING_DELIVERY_SECRET: SECRET
    },
    now: () => "2026-07-23T12:00:00.000Z",
    fetchImpl: async (url, options) => {
      request = { url, options };
      const envelope = JSON.parse(options.body);
      const receipt = {
        eventId: envelope.eventId,
        payloadDigest: envelope.payloadDigest,
        providerMessageId: "provider-message-1",
        status: "accepted",
        occurredAt: "2026-07-23T12:00:01.000Z"
      };
      receipt.signature = createHmac("sha256", SECRET).update(stableStringify({
        eventId: receipt.eventId,
        payloadDigest: receipt.payloadDigest,
        providerMessageId: receipt.providerMessageId,
        status: receipt.status,
        occurredAt: receipt.occurredAt
      })).digest("hex");
      return { ok: true, status: 200, text: async () => JSON.stringify(receipt) };
    }
  });
  const receipt = await adapter(event(), {
    workerId: "worker-1",
    runId: "run-1",
    attempt: 1
  });
  assert.equal(receipt.providerMessageId, "provider-message-1");
  assert.equal(request.options.headers["idempotency-key"], "nursing:create:command-1");
  assert.equal(
    request.options.headers["x-care-signature"],
    createHmac("sha256", SECRET).update(request.options.body).digest("hex")
  );
  assert.equal(request.options.body.includes(SECRET), false);
});

test("signed delivery adapter fails closed without a configured endpoint", async () => {
  const adapter = createSignedDeliveryAdapter("escort", {
    env: { NODE_ENV: "production", CARE_ESCORT_DELIVERY_SECRET: SECRET },
    fetchImpl: async () => {
      throw new Error("must not call");
    }
  });
  await assert.rejects(() => adapter(event(), {}), (error) => error.code === "CARE_DELIVERY_ENDPOINT_MISSING");
});

test("signed delivery adapter rejects unsigned binding changes", async () => {
  const adapter = createSignedDeliveryAdapter("escort", {
    env: {
      NODE_ENV: "production",
      CARE_ESCORT_DELIVERY_URL: "https://gateway.example.test/care/escort",
      CARE_ESCORT_DELIVERY_SECRET: SECRET
    },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        eventId: "another-event",
        payloadDigest: "a".repeat(64),
        providerMessageId: "provider-message-2",
        status: "accepted"
      })
    })
  });
  await assert.rejects(() => adapter(event(), {}), (error) => error.code === "CARE_DELIVERY_RECEIPT_BINDING_INVALID");
});
