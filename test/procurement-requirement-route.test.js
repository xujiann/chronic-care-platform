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
  let reads = 0;
  let bodyReads = 0;
  const segment = createRouteSegment({
    ...runtime,
    ...(options.runtime || {}),
    appendSecurityEvent: (event) => audits.push(event),
    collectJson: async (...args) => {
      bodyReads += 1;
      if (options.collectJson) return options.collectJson(...args);
      return options.payload || {};
    },
    prependAuditTrailEntry: options.prependAuditTrailEntry || ((rows, event) => {
      audits.push(event);
      return [event, ...(Array.isArray(rows) ? rows : [])];
    }),
    randomUUID: () => "audit-event-route-0001",
    readDatabase: () => { reads += 1; return state; },
    requireApiRole: options.requireApiRole || (() => ({ name: "governance-reviewer", role: "commission" })),
    sendJson: (_res, status, body) => responses.push({ status, body }),
    writeDatabase: options.writeDatabase || ((next) => { calls.push(next); state = next; })
  });
  return { audits, bodyReads: () => bodyReads, calls, reads: () => reads, responses, segment, state: () => state };
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

test("requirement review route fails closed for a legacy receipt without an exact snapshot", async () => {
  const fixture = harness({
    payload: { action: "accept", expectedVersion: 0, note: "历史回执缺少结果快照时不能重新推导响应" },
    runtime: {
      applyProcurementRequirementReviewAction() {
        const error = new Error("internal legacy receipt details");
        error.code = "PROCUREMENT_REQUIREMENT_REPLAY_UNAVAILABLE";
        throw error;
      }
    }
  });
  await fixture.segment.handle(
    { method: "POST", headers: { "idempotency-key": "review-command-route-legacy" } }, {},
    new URL("https://example.gov.cn/api/platform/productization/requirements/PR-SAMPLE-001-R001/actions")
  );
  assert.equal(fixture.responses[0].status, 409);
  assert.equal(fixture.responses[0].body.code, "PROCUREMENT_REQUIREMENT_REPLAY_UNAVAILABLE");
  assert.doesNotMatch(JSON.stringify(fixture.responses[0]), /internal|details/i);
  assert.equal(fixture.calls.length, 0);
  assert.equal(fixture.audits.length, 0);
});

test("requirement review route requires an idempotency key and keeps denied access opaque", async () => {
  const missingKey = harness({ payload: { action: "accept" } });
  await missingKey.segment.handle(
    { method: "POST", headers: {} },
    {},
    new URL("https://example.gov.cn/api/platform/productization/requirements/PR-SAMPLE-001-R001/actions")
  );
  assert.equal(missingKey.responses[0].status, 400);
  assert.equal(missingKey.responses[0].body.code, "PROCUREMENT_REQUIREMENT_IDEMPOTENCY_KEY_REQUIRED");
  assert.equal(missingKey.calls.length, 0);
  assert.equal(missingKey.reads(), 0);
  assert.equal(missingKey.bodyReads(), 0);

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
  assert.equal(denied.reads(), 0);
  assert.equal(denied.bodyReads(), 0);
});

test("requirement review route returns stable redacted input and not-found errors", async () => {
  const invalidJson = harness({ collectJson: async () => { throw new SyntaxError("secret raw source C:\\private\\source.pdf"); } });
  await invalidJson.segment.handle(
    { method: "POST", headers: { "idempotency-key": "review-command-route-0004" } }, {},
    new URL("https://example.gov.cn/api/platform/productization/requirements/PR-SAMPLE-001-R001/actions")
  );
  assert.deepEqual(invalidJson.responses[0], {
    status: 400,
    body: { ok: false, error: "Bad Request", code: "PROCUREMENT_REQUIREMENT_INPUT_INVALID", message: "招标需求复核请求无效。" }
  });
  assert.doesNotMatch(JSON.stringify(invalidJson.responses[0]), /secret|private|source\.pdf/i);
  assert.equal(invalidJson.reads(), 0);

  const missing = harness({ payload: { action: "accept", expectedVersion: 0, note: "人工复核说明内容符合受控长度要求" } });
  await missing.segment.handle(
    { method: "POST", headers: { "idempotency-key": "review-command-route-0005" } }, {},
    new URL("https://example.gov.cn/api/platform/productization/requirements/PR-NOT-FOUND-0001/actions")
  );
  assert.equal(missing.responses[0].status, 404);
  assert.equal(missing.responses[0].body.code, "PROCUREMENT_REQUIREMENT_NOT_FOUND");
  assert.equal(missing.calls.length, 0);
  assert.equal(missing.audits.length, 0);
});

test("requirement review route maps command conflicts and invalid transitions to stable 409", async () => {
  let payload = { action: "accept", expectedVersion: 0, note: "人工复核确认采用当前能力映射建议" };
  const fixture = harness({ collectJson: async () => payload });
  const request = () => fixture.segment.handle(
    { method: "POST", headers: { "idempotency-key": "review-command-route-0006" } }, {},
    new URL("https://example.gov.cn/api/platform/productization/requirements/PR-SAMPLE-001-R001/actions")
  );
  await request();
  payload = { ...payload, note: "同一个幂等键不能用于另一份复核说明" };
  await request();
  assert.equal(fixture.responses[1].status, 409);
  assert.equal(fixture.responses[1].body.code, "PROCUREMENT_REQUIREMENT_COMMAND_CONFLICT");
  assert.equal(fixture.calls.length, 1);

  const stale = harness({ payload: { action: "accept", expectedVersion: 1, note: "陈旧版本请求必须由稳定冲突拒绝处理" } });
  await stale.segment.handle(
    { method: "POST", headers: { "idempotency-key": "review-command-route-stale" } }, {},
    new URL("https://example.gov.cn/api/platform/productization/requirements/PR-SAMPLE-001-R001/actions")
  );
  assert.equal(stale.responses[0].status, 409);
  assert.equal(stale.responses[0].body.code, "PROCUREMENT_REQUIREMENT_VERSION_CONFLICT");
  assert.equal(stale.calls.length, 0);

  const transition = harness({ payload: { action: "request-revision", expectedVersion: 0, note: "人工复核要求补充来源定位与能力映射" } });
  const transitionRequest = () => transition.segment.handle(
    { method: "POST", headers: { "idempotency-key": "review-command-route-transition" } }, {},
    new URL("https://example.gov.cn/api/platform/productization/requirements/PR-SAMPLE-001-R001/actions")
  );
  await transitionRequest();
  const secondTransition = harness({
    data: transition.state(),
    payload: { action: "request-revision", expectedVersion: 1, note: "当前状态再次请求修订应由稳定冲突拒绝" }
  });
  await secondTransition.segment.handle(
    { method: "POST", headers: { "idempotency-key": "review-command-route-transition-2" } }, {},
    new URL("https://example.gov.cn/api/platform/productization/requirements/PR-SAMPLE-001-R001/actions")
  );
  assert.equal(secondTransition.responses[0].status, 409);
  assert.equal(secondTransition.responses[0].body.code, "PROCUREMENT_REQUIREMENT_TRANSITION_CONFLICT");
});

test("requirement review route fails closed when audit or storage fails", async () => {
  const payload = { action: "accept", expectedVersion: 0, note: "人工复核确认采用当前能力映射建议" };
  const auditFailure = harness({
    payload,
    prependAuditTrailEntry() { throw new Error("secret C:\\audit\\failure"); }
  });
  await auditFailure.segment.handle(
    { method: "POST", headers: { "idempotency-key": "review-command-route-0007" } }, {},
    new URL("https://example.gov.cn/api/platform/productization/requirements/PR-SAMPLE-001-R001/actions")
  );
  assert.equal(auditFailure.responses[0].status, 500);
  assert.equal(auditFailure.responses[0].body.code, "PROCUREMENT_REQUIREMENT_AUDIT_FAILED");
  assert.equal(auditFailure.calls.length, 0);
  assert.doesNotMatch(JSON.stringify(auditFailure.responses[0]), /secret|audit\\failure/i);

  let writeAttempts = 0;
  const storageFailure = harness({
    payload,
    writeDatabase() { writeAttempts += 1; throw new Error("credential C:\\state\\database"); }
  });
  await storageFailure.segment.handle(
    { method: "POST", headers: { "idempotency-key": "review-command-route-0008" } }, {},
    new URL("https://example.gov.cn/api/platform/productization/requirements/PR-SAMPLE-001-R001/actions")
  );
  assert.equal(writeAttempts, 1);
  assert.equal(storageFailure.responses[0].status, 500);
  assert.equal(storageFailure.responses[0].body.code, "PROCUREMENT_REQUIREMENT_STORAGE_FAILED");
  assert.doesNotMatch(JSON.stringify(storageFailure.responses[0]), /credential|database/i);

  const storageConflict = harness({
    payload,
    writeDatabase() { const error = new Error("SQLite optimistic lock conflict details"); error.code = "STORAGE_CONFLICT"; throw error; }
  });
  await storageConflict.segment.handle(
    { method: "POST", headers: { "idempotency-key": "review-command-route-0009" } }, {},
    new URL("https://example.gov.cn/api/platform/productization/requirements/PR-SAMPLE-001-R001/actions")
  );
  assert.equal(storageConflict.responses[0].status, 409);
  assert.equal(storageConflict.responses[0].body.code, "PROCUREMENT_REQUIREMENT_VERSION_CONFLICT");
});
