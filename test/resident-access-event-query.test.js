"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { auditHashFor } = require("../src/identity-security/audit-chain");
const { queryResidentAccessEvent } = require("../src/identity-security/resident-access-event-query");

function fixture() {
  const event = { id: "access-1", residentId: "r1", at: "2026-09-14T00:00:00.000Z", actor: "demo-provider", role: "institution", scope: "record", purpose: "care", result: "拒绝", previousAuditHash: "" };
  event.auditHash = auditHashFor(event);
  return { data: { residents: [{ id: "r1" }, { id: "r2" }], dataAccessLogs: [event] }, user: { id: "u1", role: "citizen", residentId: "r1" }, accessLogId: "access-1" };
}

test("query returns only immutable v1 identity and does not recognize legality or mutate audit", () => {
  const input = fixture();
  const before = structuredClone(input);
  const result = queryResidentAccessEvent(input);
  assert.deepEqual(result, { schemaVersion: "resident-access-event.v1", accessLogId: "access-1", residentId: "r1" });
  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(input, before);
});

for (const role of ["commission", "institution", "county", "", null]) {
  test(`query denies non-personal role ${role}`, () => {
    const input = fixture();
    input.user.role = role;
    assert.throws(() => queryResidentAccessEvent(input), { code: "RESIDENT_ACCESS_EVENT_SCOPE_DENIED", statusCode: 403 });
  });
}

for (const [name, mutate, statusCode] of [
  ["family proxy", (x) => { x.user.residentId = "r2"; }, 403],
  ["missing actor", (x) => { delete x.user.id; }, 403],
  ["missing event", (x) => { x.accessLogId = "absent"; }, 404],
  ["whitespace event alias", (x) => { x.accessLogId = " access-1"; }, 400],
  ["non-string event", (x) => { x.accessLogId = 1; }, 400],
  ["duplicate event", (x) => { x.data.dataAccessLogs.push({ ...x.data.dataAccessLogs[0] }); }, 409],
  ["orphan resident", (x) => { x.data.residents = []; }, 409],
  ["duplicate resident", (x) => { x.data.residents.push({ id: "r1" }); }, 409],
  ["non-array audit", (x) => { x.data.dataAccessLogs = {}; }, 409],
  ["unsealed audit", (x) => { delete x.data.dataAccessLogs[0].auditHash; }, 409],
  ["tampered audit", (x) => { x.data.dataAccessLogs[0].result = "允许"; }, 409],
  ["broken link", (x) => { x.data.dataAccessLogs[0].previousAuditHash = "a".repeat(64); }, 409],
  ["malformed sealed event", (x) => { const e = x.data.dataAccessLogs[0]; e.purpose = {}; e.auditHash = auditHashFor(e); }, 409],
  ["invalid sealed time", (x) => { const e = x.data.dataAccessLogs[0]; e.at = "not-a-time"; e.auditHash = auditHashFor(e); }, 409]
]) {
  test(`query fails closed for ${name}`, () => {
    const input = fixture();
    mutate(input);
    const before = structuredClone(input);
    assert.throws(() => queryResidentAccessEvent(input), (error) => error.statusCode === statusCode && /^RESIDENT_ACCESS_EVENT_/.test(error.code));
    assert.deepEqual(input, before);
  });
}
