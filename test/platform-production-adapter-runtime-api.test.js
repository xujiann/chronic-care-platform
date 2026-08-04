"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createRouteSegment
} = require("../src/http/routes/platform-governance/production-operations");
const {
  operationalControlPlaneReadiness,
  pilotCutoverControlPlaneReadiness,
  shadowRelayControlPlaneReadiness
} = require("../server");

test("production adapter runtime API is commission-only, read-only and payload-safe", async () => {
  const events = [];
  let response = null;
  const runtime = {
    appendSecurityEvent: (event) => events.push(event),
    productionAdapterRuntimeReadiness: async () => ({
      mode: "disabled",
      workersEligible: false,
      productionReady: false,
      credentialsExposed: false
    }),
    shadowRelayControlPlaneReadiness: async () => ({
      schema: "shadow-relay-control-plane-v1",
      ok: false,
      receipts: 0,
      payloadsExposed: false,
      productionReady: false
    }),
    operationalControlPlaneReadiness: async () => ({
      schema: "platform-operational-control-report-v1",
      localReady: false,
      externalReady: false,
      operationalReady: false,
      sensitiveDataExposed: false,
      productionReady: false
    }),
    pilotCutoverControlPlaneReadiness: async () => ({
      schema: "pilot-cutover-decision-v1",
      decision: "NO-GO",
      cutoverExecutionAuthorized: false,
      productionPrimary: false,
      productionReady: false
    }),
    requireApiRole: () => ({ name: "commission-user", role: "commission" }),
    sendJson: (_res, status, payload) => { response = { status, payload }; }
  };
  const segment = createRouteSegment(runtime);
  const handled = await segment.handle(
    { method: "GET" },
    {},
    new URL("http://localhost/api/production-adapters/runtime")
  );
  assert.equal(handled, true);
  assert.equal(response.status, 200);
  assert.equal(response.payload.productionReady, false);
  assert.equal(events[0].action, "production-adapter-runtime-read");
  assert.doesNotMatch(JSON.stringify(response), /password|secret|patient/i);

  const shadowHandled = await segment.handle(
    { method: "GET" },
    {},
    new URL("http://localhost/api/production-adapters/shadow-relay")
  );
  assert.equal(shadowHandled, true);
  assert.equal(response.status, 200);
  assert.equal(response.payload.schema, "shadow-relay-control-plane-v1");
  assert.equal(response.payload.ok, false);
  assert.equal(events[1].action, "shadow-relay-control-plane-read");
  assert.doesNotMatch(JSON.stringify(response), /password|secret|patient/i);

  const operationsHandled = await segment.handle(
    { method: "GET" },
    {},
    new URL("http://localhost/api/production-adapters/operational-control")
  );
  assert.equal(operationsHandled, true);
  assert.equal(response.status, 200);
  assert.equal(response.payload.schema, "platform-operational-control-report-v1");
  assert.equal(response.payload.operationalReady, false);
  assert.equal(events[2].action, "operational-control-plane-read");
  assert.doesNotMatch(JSON.stringify(response), /password|secret|patient/i);

  const cutoverHandled = await segment.handle(
    { method: "GET" },
    {},
    new URL("http://localhost/api/production-adapters/pilot-cutover")
  );
  assert.equal(cutoverHandled, true);
  assert.equal(response.status, 200);
  assert.equal(response.payload.decision, "NO-GO");
  assert.equal(response.payload.cutoverExecutionAuthorized, false);
  assert.equal(events[3].action, "pilot-cutover-control-plane-read");
});

test("server pilot cutover control plane fails closed without a package", async () => {
  const previousFile = process.env.PLATFORM_PILOT_CUTOVER_INPUT_FILE;
  const previousLedger = process.env.PLATFORM_PILOT_CUTOVER_AUTHORIZATION_LEDGER_FILE;
  delete process.env.PLATFORM_PILOT_CUTOVER_INPUT_FILE;
  delete process.env.PLATFORM_PILOT_CUTOVER_AUTHORIZATION_LEDGER_FILE;
  try {
    const report = await pilotCutoverControlPlaneReadiness();
    assert.equal(report.schema, "pilot-cutover-authorization-control-v1");
    assert.equal(report.decision, "NO-GO");
    assert.equal(report.checks.authorizationLedger, false);
    assert.equal(report.checks.externalEvidenceRegistry, false);
    assert.equal(report.cutoverExecutionAuthorized, false);
    assert.equal(report.productionPrimary, false);
    assert.equal(report.productionReady, false);
    assert.equal(report.patientDataExposed, false);
  } finally {
    if (previousFile === undefined) delete process.env.PLATFORM_PILOT_CUTOVER_INPUT_FILE;
    else process.env.PLATFORM_PILOT_CUTOVER_INPUT_FILE = previousFile;
    if (previousLedger === undefined) delete process.env.PLATFORM_PILOT_CUTOVER_AUTHORIZATION_LEDGER_FILE;
    else process.env.PLATFORM_PILOT_CUTOVER_AUTHORIZATION_LEDGER_FILE = previousLedger;
  }
});

test("server operational control plane fails closed without an input file", async () => {
  const previousFile = process.env.PLATFORM_OPERATIONAL_CONTROL_INPUT_FILE;
  delete process.env.PLATFORM_OPERATIONAL_CONTROL_INPUT_FILE;
  try {
    const report = await operationalControlPlaneReadiness();
    assert.equal(report.schema, "platform-operational-control-report-v1");
    assert.equal(report.localReady, false);
    assert.equal(report.externalReady, false);
    assert.equal(report.operationalReady, false);
    assert.equal(report.sensitiveDataExposed, false);
    assert.equal(report.productionReady, false);
    assert.equal(report.technicalEvidenceFingerprint, "");
  } finally {
    if (previousFile === undefined) delete process.env.PLATFORM_OPERATIONAL_CONTROL_INPUT_FILE;
    else process.env.PLATFORM_OPERATIONAL_CONTROL_INPUT_FILE = previousFile;
  }
});

test("server control plane fails closed without an operations ledger", async () => {
  const previousFile = process.env.PLATFORM_SHADOW_OPERATIONS_FILE;
  const previousAge = process.env.PLATFORM_SHADOW_RECONCILIATION_MAX_AGE_MINUTES;
  delete process.env.PLATFORM_SHADOW_OPERATIONS_FILE;
  process.env.PLATFORM_SHADOW_RECONCILIATION_MAX_AGE_MINUTES = "15";
  try {
    const report = await shadowRelayControlPlaneReadiness();
    assert.equal(report.schema, "shadow-relay-control-plane-v1");
    assert.equal(report.ok, false);
    assert.equal(report.maximumAgeMinutes, 15);
    assert.equal(report.domains.referral.ok, false);
    assert.equal(report.domains.emergency.ok, false);
    assert.equal(report.payloadsExposed, false);
    assert.equal(report.productionReady, false);
    assert.doesNotMatch(JSON.stringify(report), /password|secret|patient/i);
  } finally {
    if (previousFile === undefined) delete process.env.PLATFORM_SHADOW_OPERATIONS_FILE;
    else process.env.PLATFORM_SHADOW_OPERATIONS_FILE = previousFile;
    if (previousAge === undefined) {
      delete process.env.PLATFORM_SHADOW_RECONCILIATION_MAX_AGE_MINUTES;
    } else {
      process.env.PLATFORM_SHADOW_RECONCILIATION_MAX_AGE_MINUTES = previousAge;
    }
  }
});
