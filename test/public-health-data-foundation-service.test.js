"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildPublicHealthDataFoundation,
  ingestPublicHealthSurveillanceSignalToState,
  normalizePublicHealthSurveillanceSignal
} = require("../public-health-data-foundation-service");

function syndromePayload(overrides = {}) {
  return {
    sourceId: "ph-source-clinical-syndrome",
    externalSignalId: "EMR-SYNDROME-20260728-001",
    signalType: "clinical-syndrome",
    institutionId: "medical-institution-001",
    regionCode: "210202",
    observedAt: "2026-07-28T08:00:00.000Z",
    metrics: [{
      metricCode: "fever-respiratory-count",
      value: 8,
      unit: "cases/24h",
      baseline: 3
    }],
    evidenceRefs: ["EMR-SYNDROME-BATCH-20260728-001"],
    idempotencyKey: "signal-intake-syndrome-20260728-001",
    ...overrides
  };
}

test("data foundation registers the planning data sources and catalog without production readiness", () => {
  const foundation = buildPublicHealthDataFoundation();
  assert.equal(foundation.ok, true);
  assert.equal(foundation.summary.sources, 8);
  assert.equal(foundation.summary.registeredSources, 8);
  assert.equal(foundation.summary.catalogEntries, 7);
  assert.equal(foundation.productionReady, false);
  assert.equal(foundation.sources.every((item) => item.owner && item.stewardRole && item.sharingScope), true);
  assert.equal(JSON.stringify(foundation).includes("endpoint"), false);
});

test("signal intake persists a minimized traceable record and remains idempotent", () => {
  const user = { name: "医院公卫科", role: "medical-public-health" };
  const first = ingestPublicHealthSurveillanceSignalToState({}, syndromePayload(), user, {
    at: "2026-07-28T08:01:00.000Z"
  });
  assert.equal(first.ok, true);
  assert.equal(first.idempotent, false);
  assert.equal(first.signal.workflowState, "received");
  assert.equal(first.nextData.publicHealthSurveillanceSignals.length, 1);
  assert.equal(first.nextData.publicHealthDataLineageAudit.length, 1);
  assert.equal(first.dataFoundation.summary.activeSources, 1);
  assert.equal(first.dataFoundation.summary.qualityFindings, 0);
  assert.equal(first.productionReady, false);

  const replay = ingestPublicHealthSurveillanceSignalToState(
    first.nextData,
    syndromePayload(),
    user,
    { at: "2026-07-28T08:01:00.000Z" }
  );
  assert.equal(replay.idempotent, true);
  assert.equal(replay.nextData.publicHealthSurveillanceSignals.length, 1);
  assert.equal(replay.nextData.publicHealthDataLineageAudit.length, 1);

  const serialized = JSON.stringify(first.nextData);
  assert.equal(serialized.includes("EMR-SYNDROME-20260728-001"), false);
  assert.equal(serialized.includes("signal-intake-syndrome-20260728-001"), false);
  assert.equal(serialized.includes("residentId"), false);
});

test("signal intake rejects direct identifiers unauthorized sources and conflicting replay", () => {
  assert.throws(() => normalizePublicHealthSurveillanceSignal(
    syndromePayload({ residentId: "resident-001" })
  ), /direct resident identifier/);
  assert.throws(() => ingestPublicHealthSurveillanceSignalToState(
    {},
    syndromePayload(),
    { name: "居民", role: "resident" }
  ), /not allowed/);
  assert.throws(() => ingestPublicHealthSurveillanceSignalToState(
    {},
    syndromePayload({ sourceId: "ph-source-laboratory-pathogen" }),
    { name: "医院公卫科", role: "medical-public-health" }
  ), /type is not allowed/);

  const first = ingestPublicHealthSurveillanceSignalToState(
    {},
    syndromePayload(),
    { name: "医院公卫科", role: "medical-public-health" }
  );
  assert.throws(() => ingestPublicHealthSurveillanceSignalToState(
    first.nextData,
    syndromePayload({
      metrics: [{ metricCode: "fever-respiratory-count", value: 99, unit: "cases/24h" }]
    }),
    { name: "医院公卫科", role: "medical-public-health" }
  ), /conflict/);
});

test("data foundation exposes duplicate and tampered persisted signals as quality findings", () => {
  const first = ingestPublicHealthSurveillanceSignalToState(
    {},
    syndromePayload(),
    { name: "医院公卫科", role: "medical-public-health" }
  );
  const duplicate = JSON.parse(JSON.stringify(first.signal));
  duplicate.id = "forged-duplicate-signal";
  duplicate.patientName = "不应出现";
  const foundation = buildPublicHealthDataFoundation({
    data: {
      ...first.nextData,
      publicHealthSurveillanceSignals: [first.signal, duplicate]
    }
  });
  assert.equal(foundation.ok, false);
  assert.equal(foundation.qualityFindings.some((item) => item.code === "duplicate-source-record"), true);
  assert.equal(foundation.qualityFindings.some((item) => item.code === "direct-identifier-present"), true);
  assert.equal(foundation.productionReady, false);
});

test("data foundation rejects persisted signal content or human-verification tampering", () => {
  const first = ingestPublicHealthSurveillanceSignalToState(
    {},
    syndromePayload(),
    { name: "医院公卫科", role: "medical-public-health" }
  );
  const contentTampered = JSON.parse(JSON.stringify(first.signal));
  contentTampered.metrics[0].value = 999;
  let foundation = buildPublicHealthDataFoundation({
    data: {
      ...first.nextData,
      publicHealthSurveillanceSignals: [contentTampered]
    }
  });
  assert.equal(foundation.ok, false);
  assert.equal(foundation.qualityFindings.some((item) => item.code === "signal-content-fingerprint-invalid"), true);

  const verificationTampered = JSON.parse(JSON.stringify(first.signal));
  verificationTampered.version = 2;
  verificationTampered.workflowState = "human-verified";
  verificationTampered.verification = {
    decision: "confirmed",
    verifiedBy: "伪造核验人",
    role: "system",
    at: "2026-07-28T08:05:00.000Z",
    note: "客户端自报核验",
    evidenceRefs: ["FORGED-EVIDENCE"],
    idempotencyKeyHash: "a".repeat(64),
    payloadFingerprint: "b".repeat(64)
  };
  foundation = buildPublicHealthDataFoundation({
    data: {
      ...first.nextData,
      publicHealthSurveillanceSignals: [verificationTampered]
    }
  });
  assert.equal(foundation.ok, false);
  assert.equal(foundation.qualityFindings.some((item) => item.code === "human-verification-integrity-invalid"), true);
  assert.equal(foundation.productionReady, false);
});
