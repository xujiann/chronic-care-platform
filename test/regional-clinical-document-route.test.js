"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createRouteSegments } = require("../src/http/routes/integration/regional-clinical-documents");

function harness(options = {}) {
  const calls = { reads: 0, audits: [], roles: [] };
  const runtime = {
    appendSecurityEvent(event) { calls.audits.push(event); },
    readDatabase() { calls.reads += 1; return structuredClone(options.data || { integrationGatewayEvents: [], secureAttachments: [] }); },
    requireApiRole(_req, _res, roles, route) {
      calls.roles.push({ roles, route });
      return options.authorized === false ? null : (options.user || { role: "institution", orgCode: "MR1", username: "doctor" });
    },
    sendJson(res, status, body) { res.status = status; res.body = body; }
  };
  const [segment] = createRouteSegments(runtime);
  return {
    calls,
    async request() {
      const res = {};
      const handled = await segment.handle(
        { method: "GET", headers: {} },
        res,
        new URL("http://platform.test/api/integration/clinical-documents/center")
      );
      assert.equal(handled, true);
      return res;
    }
  };
}

test("clinical document center authenticates before reading integration state", async () => {
  const subject = harness({ authorized: false });
  const response = await subject.request();
  assert.equal(response.status, undefined);
  assert.equal(subject.calls.reads, 0);
  assert.deepEqual(subject.calls.roles, [{
    roles: ["commission", "institution"],
    route: "/api/integration/clinical-documents/center"
  }]);
});

test("clinical document center returns a minimized NO-GO view and audits the read", async () => {
  const subject = harness();
  const response = await subject.request();
  assert.equal(response.status, 200);
  assert.equal(response.body.schemaVersion, "regional-clinical-document-center-v1");
  assert.equal(response.body.productionReady, false);
  assert.equal(subject.calls.reads, 1);
  assert.equal(subject.calls.audits.length, 1);
  assert.equal(subject.calls.audits[0].action, "regional clinical document center read");
});

test("clinical document center maps missing institution scope to a stable forbidden response", async () => {
  const subject = harness({ user: { role: "institution", orgCode: "", username: "unbound" } });
  const response = await subject.request();
  assert.equal(response.status, 403);
  assert.equal(response.body.code, "REGIONAL_CLINICAL_DOCUMENT_SCOPE_REQUIRED");
  assert.equal(response.body.productionReady, false);
  assert.equal(subject.calls.audits.at(-1).result, "denied");
});

