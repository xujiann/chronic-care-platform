"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const promotionProgram = require("../config/p0-data-promotions.json");
const { promotionPhaseCounts } = require("../src/platform/data/promotion-contract");
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
  const phases = promotionPhaseCounts(promotionProgram);
  const handled = await fixture.segment.handle({ method: "GET" }, {}, new URL("https://example.gov.cn/api/platform/productization/center"));
  assert.equal(handled, true);
  assert.equal(fixture.responses[0].status, 200);
  assert.equal(fixture.responses[0].body.productionReady, false);
  assert.equal(fixture.responses[0].body.dataPromotion.summary.promotedP0, phases.promotedP0);
  assert.equal(fixture.responses[0].body.dataPromotion.summary.repositoryPlanReady, phases.repositoryPlanReady);
  assert.equal(fixture.responses[0].body.dataPromotion.summary.firstReleaseMigrationPlans, 20);
  assert.equal(fixture.audits[0].action, "platform-productization-center-read");
  assert.match(fixture.audits[0].detail, /12 promoted P0; 19 owner-reviewed repository plan-ready; 20 persistent first-release plans/);
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

test("enhancement cockpit is commission-only and exposes three fail-closed lines", async () => {
  const fixture = harness({
    runtime: {
      buildPlatformEnhancementCockpit: () => ({
        schemaVersion: "platform-enhancement-cockpit-v1",
        localControlReady: true,
        productionReady: false,
        containsBusinessPayload: false,
        containsCredentials: false,
        summary: { productIterations: 6, workItems: 34 },
        lines: { data: { productionReady: false }, care: { productionReady: false }, product: { productionReady: false } },
        cockpit: { schemaVersion: "product-regional-operations-view-model-v1", cards: [], workItems: [], regions: [], configurationDiffs: [], productionReady: false }
      })
    }
  });
  const url = new URL("https://example.gov.cn/api/platform/productization/enhancements/cockpit");
  assert.equal(await fixture.segment.handle({ method: "GET" }, {}, url), true);
  assert.equal(fixture.responses[0].status, 200);
  assert.equal(fixture.responses[0].body.productionReady, false);
  assert.equal(fixture.responses[0].body.lines.care.productionReady, false);
  assert.equal(fixture.audits[0].action, "platform-enhancement-cockpit-read");
  assert.equal(await fixture.segment.handle({ method: "POST" }, {}, url), false);
});

test("work item v2 route binds the actor to platform governance and persists metadata", async () => {
  const calls = [];
  const fixture = harness({
    payload: { commandId: "command-v2-001", action: "escalate", expectedVersion: 0, note: "requires governance follow-up" },
    runtime: {
      applyPlatformWorkItemV2GovernanceAction: (data, payload, user) => {
        calls.push({ data, payload, user });
        return { data: { platformWorkItemsV2: [{ id: payload.itemId }] }, result: { id: payload.itemId, version: 1, productionReady: false }, replayed: false };
      }
    }
  });
  const url = new URL("https://example.gov.cn/api/platform/productization/work-items-v2/w2-demo-0001/actions");
  assert.equal(await fixture.segment.handle({ method: "POST" }, {}, url), true);
  assert.equal(calls[0].payload.itemId, "w2-demo-0001");
  assert.equal(calls[0].user.role, "commission");
  assert.equal(fixture.responses[0].body.productionReady, false);
  assert.equal(fixture.audits[0].action, "platform-work-item-v2-escalate");
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
