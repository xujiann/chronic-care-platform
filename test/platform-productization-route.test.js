"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const runtime = require("../src/platform/productization/runtime");
const { createRouteSegment } = require("../src/http/routes/platform-governance/productization-center");

function harness(options = {}) {
  let state = structuredClone(options.data || {});
  const responses = [];
  const audits = [];
  const segment = createRouteSegment({
    ...runtime,
    ...(options.runtime || {}),
    appendSecurityEvent: (event) => audits.push(event),
    collectJson: async () => options.payload || {},
    readDatabase: () => state,
    requireApiRole: options.requireApiRole || (() => ({ name: "governance-operator", role: "commission" })),
    sendJson: (_res, status, body) => responses.push({ status, body }),
    writeDatabase: (next) => { state = next; }
  });
  return { audits, responses, segment, state: () => state };
}

test("productization center is commission-only and production fail closed", async () => {
  const fixture = harness();
  const handled = await fixture.segment.handle({ method: "GET" }, {}, new URL("https://example.gov.cn/api/platform/productization/center"));
  assert.equal(handled, true);
  assert.equal(fixture.responses[0].status, 200);
  assert.equal(fixture.responses[0].body.productionReady, false);
  assert.equal(fixture.responses[0].body.dataPromotion.summary.promotedP0, 12);
  assert.equal(fixture.audits[0].action, "platform-productization-center-read");
});

test("product operations cockpit is commission-only, read-only and minimized", async () => {
  const calls = [];
  const fixture = harness({
    runtime: {
      buildPlatformProductOperationsCockpit: (data) => {
        calls.push(data);
        return {
          schemaVersion: "platform-product-operations-cockpit-v1",
          localControlReady: true,
          siteReady: false,
          productionReady: false,
          containsBusinessPayload: false,
          containsCredentials: false,
          summary: { projectedWorkItems: 34, regionalSites: 2 },
          cockpit: { schemaVersion: "product-operations-view-model-v1", cards: [], sections: [], workItems: [], productionReady: false }
        };
      }
    },
    data: { patientName: "must-not-project" }
  });
  const url = new URL("https://example.gov.cn/api/platform/productization/operations/cockpit");
  assert.equal(await fixture.segment.handle({ method: "GET" }, {}, url), true);
  assert.equal(fixture.responses[0].status, 200);
  assert.equal(fixture.responses[0].body.productionReady, false);
  assert.equal(fixture.responses[0].body.containsBusinessPayload, false);
  assert.equal(fixture.audits[0].action, "platform-product-operations-cockpit-read");
  assert.equal(calls.length, 1);
  assert.equal(await fixture.segment.handle({ method: "POST" }, {}, url), false);
  assert.equal(fixture.responses.length, 1);
});

test("product operations cockpit keeps denied access opaque", async () => {
  const fixture = harness({ requireApiRole: () => null });
  const handled = await fixture.segment.handle({ method: "GET" }, {}, new URL("https://example.gov.cn/api/platform/productization/operations/cockpit"));
  assert.equal(handled, true);
  assert.equal(fixture.responses.length, 0);
  assert.equal(fixture.audits.length, 0);
});

test("institution profile and synthetic run APIs persist minimized metadata", async () => {
  const profile = harness({ payload: { commandId: "profile-command-001", regionCode: "210200", institutionSlot: "primary-hospital", adapters: ["hospital-his"] } });
  await profile.segment.handle({ method: "POST" }, {}, new URL("https://example.gov.cn/api/platform/productization/institutions/profiles"));
  assert.equal(profile.responses[0].status, 201);
  assert.equal(profile.responses[0].body.productionReady, false);
  assert.equal(profile.state().institutionIntegrationProfiles.length, 1);

  const synthetic = harness({
    data: profile.state(),
    payload: { commandId: "synthetic-command-001", expectedVersion: 0 }
  });
  await synthetic.segment.handle({ method: "POST" }, {}, new URL("https://example.gov.cn/api/platform/productization/institutions/profiles/iip-210200-primary-hospital/synthetic-runs"));
  assert.equal(synthetic.responses[0].status, 201);
  assert.equal(synthetic.responses[0].body.run.synthetic, true);
  assert.equal(synthetic.responses[0].body.run.productionReady, false);
  assert.equal(JSON.stringify(synthetic.responses[0].body).includes("patient"), false);
});

test("productization route keeps denied access opaque", async () => {
  const fixture = harness({ requireApiRole: () => null });
  const handled = await fixture.segment.handle({ method: "GET" }, {}, new URL("https://example.gov.cn/api/platform/productization/center"));
  assert.equal(handled, true);
  assert.equal(fixture.responses.length, 0);
  assert.equal(fixture.audits.length, 0);
});
