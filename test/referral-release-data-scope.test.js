"use strict";

const assert = require("node:assert/strict");
const { once } = require("node:events");
const http = require("node:http");
const test = require("node:test");
const { createRouteSegments } = require("../src/http/routes/care-coordination");

async function fixture(t, initialState) {
  let state = structuredClone(initialState);
  let writes = 0;
  const sendJson = (res, status, body) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const runtime = {
    readDatabase: () => structuredClone(state),
    writeDatabase: (next) => { state = structuredClone(next); writes += 1; },
    sendJson,
    requireApiRole(req, res, roles) {
      const role = req.headers["x-test-role"];
      if (!role) { sendJson(res, 401, { error: "Unauthorized" }); return null; }
      if (!roles.includes(role)) { sendJson(res, 403, { error: "Forbidden" }); return null; }
      return { role, name: "Synthetic actor", username: `synthetic-${role}`, orgCode: req.headers["x-test-org"] || "" };
    },
    canAccessReferralTeleconsultation(user, item) {
      return user.role === "commission" || user.role === "county"
        || user.role === "institution" && item.sourceInstitutionCode === user.orgCode;
    },
    buildReferralTeleconsultationJointTestPack(data) {
      const sample = data.referralTeleconsultations?.[0] || { id: "rtc-demo", residentId: "r1" };
      return { samples: [{ payload: {
        teleconsultationId: sample.id,
        residentId: sample.residentId,
        targetInstitution: sample.targetInstitution,
        department: sample.department
      } }] };
    },
    collectJson: async (req) => JSON.parse(await Array.fromAsync(req).then((chunks) => Buffer.concat(chunks).toString("utf8"))),
    acknowledgeReferralTeleconsultationEscalation(_data, item, payload) {
      return { ...item, slaDisposition: { status: payload.status } };
    },
    resealAuditTrail: (rows) => rows,
    appendDataAccessLog: () => {},
    randomUUID: () => "synthetic-audit-event"
  };
  const segment = createRouteSegments(runtime).find((item) => item.id === "care-coordination-01");
  const transport = { connections: 0, requests: 0, closed: false };
  const server = http.createServer(async (req, res) => {
    transport.requests += 1;
    try {
      if (!await segment.handle(req, res, new URL(req.url, "http://127.0.0.1"))) sendJson(res, 404, { error: "Not Found" });
    } catch (error) {
      sendJson(res, 500, { error: String(error?.message || error) });
    }
  });
  server.on("connection", () => { transport.connections += 1; });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  let closing;
  function close() {
    closing ||= new Promise((resolve, reject) => server.close((error) => {
      if (error) reject(error);
      else { transport.closed = true; resolve(); }
    }));
    return closing;
  }
  t.after(close);
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    retireIdleConnections() {
      assert.equal(server.listening, true);
      server.closeIdleConnections();
      assert.equal(server.listening, true);
    },
    transport: () => ({ ...transport }),
    state: () => state,
    writes: () => writes
  };
}

async function request(baseUrl, pathname, role, orgCode = "", options = {}) {
  // Test-local servers may reuse an origin after close. Each request owns its connection.
  return new Promise((resolve, reject) => {
    const req = http.request(baseUrl + pathname, {
      ...options,
      agent: false,
      headers: {
        "x-test-role": role,
        "x-test-org": orgCode,
        ...(options.body ? { "Content-Type": "application/json" } : {})
      }
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("aborted", () => reject(Object.assign(new Error("response aborted"), { code: "ECONNRESET" })));
      res.on("error", reject);
      res.on("end", () => {
        if (!res.complete) { reject(new Error("response incomplete")); return; }
        try { resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) }); }
        catch (error) { reject(error); }
      });
    });
    req.on("error", reject);
    req.end(options.body);
  });
}

test("joint-test samples use the caller's referral scope before building the pack", async (t) => {
  const f = await fixture(t, { referralTeleconsultations: [
    { id: "private-referral-b", residentId: "resident-b", sourceInstitutionCode: "ORG-B", targetInstitution: "Synthetic B", department: "Synthetic clinic" },
    { id: "allowed-referral-a", residentId: "resident-a", sourceInstitutionCode: "ORG-A", targetInstitution: "Synthetic A", department: "Synthetic clinic" }
  ] });

  const institution = await request(f.baseUrl, "/api/referral-teleconsultations/joint-test-pack", "institution", "ORG-A");
  assert.equal(institution.status, 200);
  assert.deepEqual(institution.body.samples.map((item) => item.payload.teleconsultationId), ["allowed-referral-a"]);
  assert.doesNotMatch(JSON.stringify(institution.body), /private-referral-b|resident-b/);

  const insurance = await request(f.baseUrl, "/api/referral-teleconsultations/joint-test-pack", "insurance");
  assert.equal(insurance.status, 200);
  assert.deepEqual(insurance.body.samples.map((item) => item.payload.teleconsultationId), ["rtc-demo"]);
  assert.doesNotMatch(JSON.stringify(insurance.body), /private-referral-b|resident-b|allowed-referral-a|resident-a/);

  const institutionWithoutScope = await request(f.baseUrl, "/api/referral-teleconsultations/joint-test-pack", "institution");
  assert.equal(institutionWithoutScope.status, 200);
  assert.deepEqual(institutionWithoutScope.body.samples.map((item) => item.payload.teleconsultationId), ["rtc-demo"]);
  assert.doesNotMatch(JSON.stringify(institutionWithoutScope.body), /private-referral-b|resident-b|allowed-referral-a|resident-a/);

  const commission = await request(f.baseUrl, "/api/referral-teleconsultations/joint-test-pack", "commission");
  assert.equal(commission.status, 200);
  assert.equal(commission.body.samples[0].payload.teleconsultationId, "private-referral-b");

  const county = await request(f.baseUrl, "/api/referral-teleconsultations/joint-test-pack", "county");
  assert.equal(county.status, 200);
  assert.equal(county.body.samples[0].payload.teleconsultationId, "private-referral-b");

  assert.equal((await request(f.baseUrl, "/api/referral-teleconsultations/joint-test-pack", "citizen")).status, 403);
  assert.equal(f.writes(), 0);
});

test("SLA acknowledgement returns a public referral while retaining private command receipts", async (t) => {
  const receipt = { commandKeyHash: "private-command-key-hash", requestDigest: "private-request-digest" };
  const f = await fixture(t, { referralTeleconsultations: [{
    id: "synthetic-referral", residentId: "synthetic-resident", sourceInstitutionCode: "ORG-A",
    _writeCommandReceipts: [receipt]
  }], taskMessages: [], securityEvents: [] });

  const acknowledged = await request(f.baseUrl, "/api/referral-teleconsultations/synthetic-referral/escalations/ack", "county", "", {
    method: "POST", body: JSON.stringify({ status: "acknowledged" })
  });
  assert.equal(acknowledged.status, 200);
  assert.equal(acknowledged.body.teleconsultation.slaDisposition.status, "acknowledged");
  assert.equal(Object.hasOwn(acknowledged.body.teleconsultation, "_writeCommandReceipts"), false);
  assert.doesNotMatch(JSON.stringify(acknowledged.body), /private-command-key-hash|private-request-digest/);
  assert.deepEqual(f.state().referralTeleconsultations[0]._writeCommandReceipts, [receipt]);
  assert.equal(f.writes(), 1);
});

test("TEST041 referral fixture does not reuse retired idle connections", async (t) => {
  const receipt = { commandKeyHash: "test041-private-key", requestDigest: "test041-private-digest" };
  const initial = { referralTeleconsultations: [{
    id: "test041-referral", residentId: "test041-resident", sourceInstitutionCode: "ORG-A", _writeCommandReceipts: [receipt]
  }], taskMessages: [], securityEvents: [] };
  const f = await fixture(t, initial);
  for (let i = 0; i < 6; i += 1) {
    assert.equal((await request(f.baseUrl, "/api/referral-teleconsultations/joint-test-pack", "county")).status, 200);
  }
  assert.equal(f.writes(), 0);
  f.retireIdleConnections();
  const response = await request(f.baseUrl, "/api/referral-teleconsultations/test041-referral/escalations/ack", "county", "", {
    method: "POST", body: JSON.stringify({ status: "acknowledged" })
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.teleconsultation.slaDisposition.status, "acknowledged");
  assert.equal(Object.hasOwn(response.body.teleconsultation, "_writeCommandReceipts"), false);
  assert.doesNotMatch(JSON.stringify(response.body), /test041-private-key|test041-private-digest/);
  assert.deepEqual(f.state().referralTeleconsultations[0]._writeCommandReceipts, [receipt]);
  assert.equal(f.writes(), 1);
  assert.equal(f.transport().requests, 7);
  assert.equal(f.transport().connections, 7);
  t.diagnostic("TEST041_HTTP_RESULT " + JSON.stringify({ listenerKeptOpen: true, idleRetirementBoundary: true, requests: 7, writes: 1 }));
});

test("TEST041 referral requests use independent connections", async (t) => {
  const f = await fixture(t, { referralTeleconsultations: [] });
  for (let i = 0; i < 3; i += 1) {
    assert.equal((await request(f.baseUrl, "/api/referral-teleconsultations/joint-test-pack", "county")).status, 200);
  }
  assert.equal(f.transport().requests, 3);
  assert.equal(f.transport().connections, 3);
  assert.equal(f.writes(), 0);
});

test("TEST041 referral transport rejects truncated responses without replay", async (t) => {
  let requests = 0;
  const server = http.createServer((req, res) => {
    requests += 1;
    req.resume();
    res.writeHead(200, { "Content-Type": "application/json", "Content-Length": "64" });
    res.write('{"ok":');
    res.flushHeaders();
    setImmediate(() => res.destroy());
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  await assert.rejects(request("http://127.0.0.1:" + server.address().port, "/synthetic-truncated", "county"), (error) => {
    assert.ok(["ECONNRESET", "UND_ERR_SOCKET"].includes(error.code || error.cause?.code));
    return true;
  });
  assert.equal(requests, 1);
});
