"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createRouteSegments } = require("../src/http/routes/regional");

function createHarness(options = {}) {
  const responses = [];
  const audits = [];
  const state = { regionalDeploymentProbeReceipts: [] };
  const segments = createRouteSegments({
    appendSecurityEvent: (event) => audits.push(event),
    environment: options.environment || {},
    readDatabase: () => state,
    regionalContext: {
      schemaVersion: "regional-public-context-v1",
      regionCode: "template"
    },
    requireApiRole: options.requireApiRole || (() => ({ name: "commission-operator", role: "commission" })),
    sendJson: (_res, status, body) => responses.push({ status, body }),
    writeDatabase: (next) => Object.assign(state, next)
  });
  return { audits, responses, segments, state };
}

test("regional operations route exposes a commission-only metadata inventory", async () => {
  const harness = createHarness();
  assert.deepEqual(harness.segments.map((item) => item.id), ["regional-01", "regional-02"]);
  const handled = await harness.segments[1].handle(
    { method: "GET", headers: {} },
    {},
    new URL("https://platform.example.gov.cn/api/regional/deployments")
  );
  assert.equal(handled, true);
  assert.equal(harness.responses[0].status, 200);
  assert.equal(harness.responses[0].body.containsBusinessData, false);
  assert.equal(harness.responses[0].body.probeTargetsExposed, false);
  assert.equal(harness.responses[0].body.productionReady, false);
  assert.equal(harness.audits[0].action, "regional-deployment-fleet-read");
});

test("regional operations route rejects client-controlled probe inputs before transport", async () => {
  const harness = createHarness({
    environment: { REGIONAL_SITE_210200_BASE_URL: "https://dalian.example.gov.cn" }
  });
  const handled = await harness.segments[1].handle(
    { method: "POST", headers: { "content-length": "24" } },
    {},
    new URL("https://platform.example.gov.cn/api/regional/deployments/210200/probes")
  );
  assert.equal(handled, true);
  assert.equal(harness.responses[0].status, 400);
  assert.equal(harness.responses[0].body.code, "REGIONAL_PROBE_CLIENT_INPUT_REJECTED");
  assert.equal(harness.audits[0].result, "denied");
  assert.equal(harness.state.regionalDeploymentProbeReceipts.length, 0);
});

test("regional dossier API aggregates only minimized control metadata", async () => {
  const harness = createHarness();
  const handled = await harness.segments[1].handle(
    { method: "GET", headers: {} },
    {},
    new URL("https://platform.example.gov.cn/api/regional/deployments/210200/dossier")
  );
  assert.equal(handled, true);
  assert.equal(harness.responses[0].status, 200);
  assert.equal(harness.responses[0].body.ok, true);
  assert.equal(harness.responses[0].body.candidateReady, false);
  assert.equal(harness.responses[0].body.productionReady, false);
  assert.equal(harness.responses[0].body.containsBusinessData, false);
  assert.equal(harness.responses[0].body.containsEndpoints, false);
  assert.equal(harness.responses[0].body.siteEvidence.evidenceReady, false);
  assert.equal(harness.responses[0].body.siteEvidence.containsEvidenceBodies, false);
  assert.equal(harness.responses[0].body.siteEvidence.containsReviewerIdentities, false);
  assert.equal(harness.responses[0].body.siteEvidence.containsSignatures, false);
  assert.equal(harness.responses[0].body.siteEvidence.containsKeyMaterial, false);
  assert.doesNotMatch(JSON.stringify(harness.responses[0].body), /controlled:\/\/|custodianRole|reviewerRole/);
  assert.equal(harness.audits[0].action, "regional-cutover-dossier-read");
});

test("regional dossier API rejects query-controlled input and unknown regions opaquely", async () => {
  const queryHarness = createHarness();
  await queryHarness.segments[1].handle(
    { method: "GET", headers: {} },
    {},
    new URL("https://platform.example.gov.cn/api/regional/deployments/210200/dossier?endpoint=https://example.org")
  );
  assert.equal(queryHarness.responses[0].status, 400);
  assert.equal(queryHarness.responses[0].body.code, "REGIONAL_DOSSIER_CLIENT_INPUT_REJECTED");

  const unknownHarness = createHarness();
  await unknownHarness.segments[1].handle(
    { method: "GET", headers: {} },
    {},
    new URL("https://platform.example.gov.cn/api/regional/deployments/000000/dossier")
  );
  assert.equal(unknownHarness.responses[0].status, 404);
  assert.equal(unknownHarness.responses[0].body.code, "REGIONAL_DOSSIER_NOT_AVAILABLE");
  assert.equal(JSON.stringify(unknownHarness.responses[0]).includes("not enabled"), false);
});

test("regional operations route keeps authentication denial opaque", async () => {
  const harness = createHarness({ requireApiRole: () => null });
  const handled = await harness.segments[1].handle(
    { method: "GET", headers: {} },
    {},
    new URL("https://platform.example.gov.cn/api/regional/deployments")
  );
  assert.equal(handled, true);
  assert.equal(harness.responses.length, 0);
  assert.equal(harness.audits.length, 0);
});
