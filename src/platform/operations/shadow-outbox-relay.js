"use strict";

const { createHash } = require("node:crypto");

const SHA256 = /^sha256:[a-f0-9]{64}$/;

function relayError(code, message, statusCode = 503) {
  return Object.assign(new Error(message), { code, statusCode });
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(
    typeof value === "string" || Buffer.isBuffer(value) ? value : stableStringify(value)
  ).digest("hex")}`;
}

function clean(value, maximum = 200) {
  return String(value || "").trim().replace(/[\r\n\t]+/g, " ").slice(0, maximum);
}

function normalizeRelayEvent(input = {}) {
  const id = clean(input.id, 200);
  const sequence = Number(input.sequence);
  const payloadDigest = clean(input.payloadDigest, 80);
  if (!id || !Number.isSafeInteger(sequence) || sequence < 1 || !SHA256.test(payloadDigest)) {
    throw relayError("SHADOW_RELAY_EVENT_INVALID", "shadow relay event identity, sequence, or digest is invalid", 400);
  }
  if (!input.payload || typeof input.payload !== "object" || Array.isArray(input.payload)) {
    throw relayError("SHADOW_RELAY_PAYLOAD_INVALID", "shadow relay payload must be an object", 400);
  }
  if (sha256(input.payload) !== payloadDigest) {
    throw relayError("SHADOW_RELAY_DIGEST_INVALID", "shadow relay payload digest does not match", 409);
  }
  return Object.freeze({
    id,
    sequence,
    payloadDigest,
    payload: structuredClone(input.payload)
  });
}

function buildDigestSnapshot(events = []) {
  const normalized = events.map((event) => {
    const id = clean(event.id, 200);
    const sequence = Number(event.sequence);
    const payloadDigest = clean(event.payloadDigest, 80);
    if (!id || !Number.isSafeInteger(sequence) || sequence < 1 || !SHA256.test(payloadDigest)) {
      throw relayError("SHADOW_RELAY_SNAPSHOT_INVALID", "shadow relay snapshot metadata is invalid", 400);
    }
    return { id, sequence, payloadDigest };
  }).sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id));
  const duplicateSequence = normalized.some((item, index) =>
    index > 0 && normalized[index - 1].sequence === item.sequence);
  if (duplicateSequence) {
    throw relayError("SHADOW_RELAY_SEQUENCE_CONFLICT", "shadow relay snapshot contains duplicate sequences", 409);
  }
  return Object.freeze({
    count: normalized.length,
    highWatermark: normalized.at(-1)?.sequence || 0,
    digest: sha256(normalized),
    payloadsExposed: false
  });
}

function compareDigestSnapshots(source = {}, target = {}) {
  const checks = Object.freeze({
    count: Number(source.count) === Number(target.count),
    highWatermark: Number(source.highWatermark) === Number(target.highWatermark),
    digest: SHA256.test(clean(source.digest, 80))
      && clean(source.digest, 80) === clean(target.digest, 80)
  });
  return Object.freeze({
    ok: Object.values(checks).every(Boolean),
    checks,
    source: Object.freeze({
      count: Number(source.count) || 0,
      highWatermark: Number(source.highWatermark) || 0,
      digest: clean(source.digest, 80)
    }),
    target: Object.freeze({
      count: Number(target.count) || 0,
      highWatermark: Number(target.highWatermark) || 0,
      digest: clean(target.digest, 80)
    }),
    payloadsExposed: false,
    productionReady: false
  });
}

function assertRelayDependencies(options = {}) {
  if (typeof options.source?.readBatch !== "function") {
    throw relayError("SHADOW_RELAY_SOURCE_INVALID", "shadow relay source must expose readBatch");
  }
  if (typeof options.sink?.enqueue !== "function") {
    throw relayError("SHADOW_RELAY_SINK_INVALID", "shadow relay sink must expose enqueue");
  }
  if (typeof options.checkpoint?.load !== "function" || typeof options.checkpoint?.save !== "function") {
    throw relayError("SHADOW_RELAY_CHECKPOINT_INVALID", "shadow relay checkpoint must expose load and save");
  }
}

async function runShadowOutboxRelayOnce(options = {}) {
  assertRelayDependencies(options);
  const relayId = clean(options.relayId, 160);
  if (!relayId) throw relayError("SHADOW_RELAY_ID_REQUIRED", "shadow relay id is required", 400);
  const current = await options.checkpoint.load(relayId) || { sequence: 0 };
  const startSequence = Number(current.sequence) || 0;
  const limit = Math.min(100, Math.max(1, Number(options.limit) || 20));
  const batch = await options.source.readBatch({ afterSequence: startSequence, limit });
  if (!Array.isArray(batch)) {
    throw relayError("SHADOW_RELAY_BATCH_INVALID", "shadow relay source returned an invalid batch");
  }
  const events = batch.map(normalizeRelayEvent);
  events.forEach((event, index) => {
    const previous = index === 0 ? startSequence : events[index - 1].sequence;
    if (event.sequence <= previous) {
      throw relayError("SHADOW_RELAY_SEQUENCE_INVALID", "shadow relay source batch is not strictly ordered", 409);
    }
  });
  const outcomes = [];
  for (const event of events) {
    const projected = typeof options.project === "function"
      ? await options.project(structuredClone(event.payload), {
        id: event.id,
        sequence: event.sequence,
        payloadDigest: event.payloadDigest
      })
      : structuredClone(event.payload);
    const result = await options.sink.enqueue(projected);
    await options.faultInjector?.("after-enqueue", {
      id: event.id,
      sequence: event.sequence,
      payloadDigest: event.payloadDigest
    });
    const checkpoint = Object.freeze({
      relayId,
      sequence: event.sequence,
      eventId: event.id,
      payloadDigest: event.payloadDigest,
      relayDigest: sha256({
        relayId,
        sequence: event.sequence,
        eventId: event.id,
        payloadDigest: event.payloadDigest
      })
    });
    await options.checkpoint.save(checkpoint);
    outcomes.push(Object.freeze({
      eventId: event.id,
      sequence: event.sequence,
      payloadDigest: event.payloadDigest,
      idempotentReplay: result?.idempotentReplay === true
    }));
  }
  return Object.freeze({
    ok: true,
    relayId,
    fromSequence: startSequence,
    toSequence: outcomes.at(-1)?.sequence || startSequence,
    relayed: outcomes.length,
    outcomes: Object.freeze(outcomes),
    payloadsExposed: false,
    productionReady: false,
    boundary: "This receipt proves only a local idempotent shadow relay step. It is not database migration, external delivery, reconciliation signoff, or production cutover evidence."
  });
}

module.exports = {
  buildDigestSnapshot,
  compareDigestSnapshots,
  normalizeRelayEvent,
  runShadowOutboxRelayOnce,
  sha256,
  stableStringify
};
