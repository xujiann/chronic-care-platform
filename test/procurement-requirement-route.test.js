"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const runtime = require("../src/platform/productization/runtime");
const { createRouteSegment } = require("../src/http/routes/platform-governance/productization-center");

function harness(options = {}) {
  let state = structuredClone(options.data || {});
  const responses = [];
  const audits = [];
  const calls = [];
  const segment = createRouteSegment({
    ...runtime,
    ...(options.runtime || {}),
    appendSecurityEvent: (event) => audits.push(event),
    collectJson: async () => options.payload || {},
    prependAuditTrailEntry: (rows, event) => {
      audits.push(event);
      return [event, ...(Array.isArray(rows) ? rows : [])];
    },
    randomUUID: () => "audit-event-route-0001",
    readDatabase: () => state,
    requireApiRole: options.requireApiRole || (() => ({ name: "governance-reviewer", role: "commission" })),
    sendJson: (_res, status, body) => responses.push({ status, body }),
    writeDatabase: (next) => { calls.push(next); state = next; }
  });
  return { audits, calls, responses, segment, state: () => state };
}

test("productization center includes fail-closed requirement governance", async () => {
  const fixture = harness();
  const handled = await fixture.segment.handle(
    { method: "GET" },
    {},
    new URL("https://example.gov.cn/api/platform/productization/center")
  );
  assert.equal(handled, true);
  assert.equal(fixture.responses[0].status, 200);
  assert.equal(fixture.responses[0].body.requirementGovernance.summary.documents, 2);
  assert.equal(fixture.responses[0].body.requirementGovernance.summary.candidates, 5);
  assert.equal(fixture.responses[0].body.requirementGovernance.productionReady, false);
  assert.equal(fixture.responses[0].body.requirementGovernance.containsRawDocument, false);
  assert.match(fixture.audits[0].detail, /5 procurement candidates/);
});

test("requirement review route binds idempotency and actor then persists minimized state", async () => {
  const calls = [];
  const fixture = harness({
    payload: { action: "accept", expectedVersion: 0, note: "经人工复核确认采用当前能力映射建议" },
    runtime: {
      applyProcurementRequirementReviewAction(data, command, user) {
        calls.push({ command, data, user });
        return {
          data: { procurementRequirementGovernance: { schemaVersion: "procurement-requirement-review-state-v1" } },
          result: { id: command.requirementId, reviewStatus: "accepted", version: 1, productionReady: false },
          replayed: false
        };
      }
    }
  });
  const handled = await fixture.segment.handle(
    { method: "POST", headers: { "idempotency-key": "review-command-route-0001" } },
    {},
    new URL("https://example.gov.cn/api/platform/productization/requirements/PR-SAMPLE-001-R001/actions")
  );
  assert.equal(handled, true);
  assert.equal(calls[0].command.commandId, "review-command-route-0001");
  assert.equal(calls[0].command.requirementId, "PR-SAMPLE-001-R001");
  assert.equal(calls[0].user.role, "commission");
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.calls[0].procurementRequirementGovernance.schemaVersion, "procurement-requirement-review-state-v1");
  assert.equal(fixture.calls[0].securityEvents.length, 1);
  assert.equal(fixture.calls[0].securityEvents[0].id, "audit-event-route-0001");
  assert.equal(fixture.responses[0].body.productionReady, false);
  assert.equal(fixture.audits[0].action, "procurement-requirement-accept");
  assert.match(fixture.audits[0].detail, /source content omitted/);
});

test("requirement review replay does not write state or duplicate audit", async () => {
  const fixture = harness({
    payload: { action: "accept", expectedVersion: 0, note: "经人工复核确认采用当前能力映射建议" },
    runtime: {
      applyProcurementRequirementReviewAction(_data, command) {
        return {
          data: {},
          result: { id: command.requirementId, version: 1, productionReady: false },
          replayed: true
        };
      }
    }
  });
  await fixture.segment.handle(
    { method: "POST", headers: { "idempotency-key": "review-command-route-0002" } },
    {},
    new URL("https://example.gov.cn/api/platform/productization/requirements/PR-SAMPLE-001-R001/actions")
  );
  assert.equal(fixture.responses[0].body.replayed, true);
  assert.equal(fixture.calls.length, 0);
  assert.equal(fixture.audits.length, 0);
});

test("requirement review route requires an idempotency key and keeps denied access opaque", async () => {
  const missingKey = harness({ payload: { action: "accept" } });
  await assert.rejects(
    () => missingKey.segment.handle(
      { method: "POST", headers: {} },
      {},
      new URL("https://example.gov.cn/api/platform/productization/requirements/PR-SAMPLE-001-R001/actions")
    ),
    /Idempotency-Key header is required/
  );
  assert.equal(missingKey.calls.length, 0);

  const denied = harness({ requireApiRole: () => null });
  const handled = await denied.segment.handle(
    { method: "POST", headers: { "idempotency-key": "review-command-route-0003" } },
    {},
    new URL("https://example.gov.cn/api/platform/productization/requirements/PR-SAMPLE-001-R001/actions")
  );
  assert.equal(handled, true);
  assert.equal(denied.responses.length, 0);
  assert.equal(denied.calls.length, 0);
  assert.equal(denied.audits.length, 0);
});
