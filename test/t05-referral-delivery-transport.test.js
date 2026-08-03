"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildReferralTransportConfig,
  createReferralDeliveryTransport,
  hmac
} = require("../src/care-coordination/referral-delivery-transport");
const { sha256, stableStringify } = require("../src/care-coordination/referral-delivery-postgres-repository");

const SECRET = "referral-delivery-test-secret-at-least-32-characters";
const ENV = {
  REFERRAL_DELIVERY_URL: "https://referral-gateway.example.test/events",
  REFERRAL_DELIVERY_HMAC_SECRET: SECRET,
  REFERRAL_DELIVERY_TRANSPORT_EVIDENCE_ID: "transport-evidence-001",
  REFERRAL_DELIVERY_SIGNING_EVIDENCE_ID: "signing-evidence-001"
};

function claim() {
  const payload = { contract: { referralId: "rf1", residentId: "r1", status: "accepted" } };
  return {
    id: "referral-event-001",
    type: "care-coordination.referral-updated.v1",
    contractId: "referral-order.v1",
    aggregateVersion: 2,
    correlationId: "trace-referral-001",
    payload,
    payloadDigest: sha256(payload),
    attempt: 1,
    leaseVersion: 1
  };
}

test("transport requires HTTPS, a strong secret, and evidence", () => {
  assert.throws(
    () => buildReferralTransportConfig({ ...ENV, REFERRAL_DELIVERY_URL: "http://gateway.test/events" }),
    (error) => error.code === "REFERRAL_TRANSPORT_HTTPS_REQUIRED"
  );
  assert.throws(
    () => buildReferralTransportConfig({ ...ENV, REFERRAL_DELIVERY_HMAC_SECRET: "short" }),
    (error) => error.code === "REFERRAL_TRANSPORT_SECRET_UNAVAILABLE"
  );
  assert.throws(
    () => buildReferralTransportConfig({ ...ENV, REFERRAL_DELIVERY_SIGNING_EVIDENCE_ID: "" }),
    (error) => error.code === "REFERRAL_TRANSPORT_EVIDENCE_REQUIRED"
  );
  const config = buildReferralTransportConfig(ENV);
  assert.equal(config.productionReady, false);
  assert.equal(config.secret, SECRET);
  assert.doesNotMatch(JSON.stringify(config), new RegExp(SECRET));
});

test("transport signs the request and requires a signed receipt bound to all five fields", async () => {
  let captured;
  const transport = createReferralDeliveryTransport({
    env: ENV,
    now: () => "2026-08-04T02:00:00.000Z",
    fetchImpl: async (url, options) => {
      captured = { url, options };
      const envelope = JSON.parse(options.body);
      const binding = {
        eventId: envelope.eventId,
        payloadDigest: envelope.payloadDigest,
        providerMessageId: "provider-message-001",
        status: "accepted",
        occurredAt: "2026-08-04T02:00:01.000Z"
      };
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ...binding, signature: hmac(SECRET, binding) })
      };
    }
  });
  const receipt = await transport(claim());
  assert.equal(receipt.signatureVerified, true);
  assert.equal(receipt.providerMessageId, "provider-message-001");
  assert.match(receipt.signatureDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(captured.url, ENV.REFERRAL_DELIVERY_URL);
  assert.equal(captured.options.headers["x-referral-signature"], hmac(SECRET, captured.options.body));
  assert.equal(captured.options.headers["idempotency-key"], "referral-event-001");
  assert.equal(captured.options.body.includes(SECRET), false);
  assert.equal(stableStringify(JSON.parse(captured.options.body)), captured.options.body);
});

test("unsigned, forged or binding-drift receipts fail closed", async () => {
  async function rejectsReceipt(mutator, expectedCode) {
    const transport = createReferralDeliveryTransport({
      env: ENV,
      fetchImpl: async (url, options) => {
        const envelope = JSON.parse(options.body);
        const binding = mutator({
          eventId: envelope.eventId,
          payloadDigest: envelope.payloadDigest,
          providerMessageId: "provider-message-001",
          status: "accepted",
          occurredAt: "2026-08-04T02:00:01.000Z"
        });
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            ...binding,
            ...(binding.includeSignature === false ? {} : { signature: hmac(SECRET, binding) })
          })
        };
      }
    });
    await assert.rejects(() => transport(claim()), (error) => error.code === expectedCode);
  }

  await rejectsReceipt((binding) => ({ ...binding, includeSignature: false }), "REFERRAL_TRANSPORT_RECEIPT_SIGNATURE_REQUIRED");
  await rejectsReceipt((binding) => ({ ...binding, eventId: "another-event" }), "REFERRAL_TRANSPORT_RECEIPT_BINDING_INVALID");

  const forged = createReferralDeliveryTransport({
    env: ENV,
    fetchImpl: async (url, options) => {
      const envelope = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          eventId: envelope.eventId,
          payloadDigest: envelope.payloadDigest,
          providerMessageId: "provider-message-001",
          status: "accepted",
          occurredAt: "2026-08-04T02:00:01.000Z",
          signature: "0".repeat(64)
        })
      };
    }
  });
  await assert.rejects(() => forged(claim()), (error) => error.code === "REFERRAL_TRANSPORT_RECEIPT_SIGNATURE_INVALID");
});
