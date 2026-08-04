"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  applyRegionalBusinessEvent,
  createRegionalBusinessLoop,
  evaluateRegionalBusinessLoop,
  sha256
} = require("../src/platform/orchestration/regional-business-loop");

function apply(state, type, version, suffix = type) {
  return applyRegionalBusinessEvent(state, {
    eventId: `event-${suffix}`,
    type,
    expectedVersion: version,
    correlationId: state.correlationId,
    causationId: `command-${suffix}`,
    payloadDigest: sha256({ type, suffix }),
    evidenceRef: `evidence://regional-loop/${suffix}`,
    occurredAt: `2030-08-04T00:0${version}:00.000Z`
  });
}

test("resident consent, referral and clinical acknowledgement form one correlated closed loop", () => {
  let state = createRegionalBusinessLoop({
    loopId: "loop-1",
    correlationId: "correlation-1",
    residentRefDigest: `sha256:${"a".repeat(64)}`,
    createdAt: "2030-08-04T00:00:00.000Z"
  });
  for (const type of [
    "resident-consent-recorded",
    "referral-created",
    "referral-accepted",
    "clinical-delivery-acknowledged",
    "loop-closed"
  ]) {
    state = apply(state, type, state.version).state;
  }
  const report = evaluateRegionalBusinessLoop(state);
  assert.equal(report.ok, true);
  assert.equal(report.phase, "closed");
  assert.equal(report.version, 5);
  assert.equal(report.residentDataExposed, false);
  assert.equal(report.clinicalDataExposed, false);
  assert.doesNotMatch(JSON.stringify(report), /residentRefDigest|evidence:\/\//);
});

test("event replay is exact and expected version prevents concurrent transition drift", () => {
  const initial = createRegionalBusinessLoop({
    loopId: "loop-2",
    correlationId: "correlation-2",
    residentRefDigest: `sha256:${"b".repeat(64)}`
  });
  const accepted = apply(initial, "resident-consent-recorded", 0);
  const duplicate = applyRegionalBusinessEvent(accepted.state, {
    ...accepted.state.events[0],
    expectedVersion: 0
  });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.state, accepted.state);
  assert.throws(
    () => apply(accepted.state, "referral-created", 0),
    (error) => error.code === "REGIONAL_BUSINESS_LOOP_VERSION_CONFLICT"
  );
});

test("a failed referral enters an explicit compensation path and cannot be reported closed", () => {
  let state = createRegionalBusinessLoop({
    loopId: "loop-3",
    correlationId: "correlation-3",
    residentRefDigest: `sha256:${"c".repeat(64)}`
  });
  state = apply(state, "resident-consent-recorded", 0).state;
  state = apply(state, "referral-created", 1).state;
  state = apply(state, "compensation-requested", 2).state;
  assert.equal(state.phase, "compensating");
  assert.equal(evaluateRegionalBusinessLoop(state).ok, false);
  state = apply(state, "compensation-completed", 3).state;
  assert.equal(state.phase, "compensated");
  assert.throws(
    () => apply(state, "loop-closed", 4),
    (error) => error.code === "REGIONAL_BUSINESS_LOOP_TRANSITION_INVALID"
  );
});
