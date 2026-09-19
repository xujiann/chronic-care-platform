"use strict";

const { verifyAuditTrail } = require("./audit-chain");

function fail(code, statusCode) {
  throw Object.assign(new Error("resident access event cannot be verified"), { code, statusCode });
}

function exactText(value, maximum) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum
    && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
}

// T01 read-only v1 port. The caller supplies its current raw persisted snapshot
// and authenticated principal, never a client identity or a normalized audit copy.
function queryResidentAccessEvent({ data, user, accessLogId } = {}) {
  if (user?.role !== "citizen" || !exactText(user.id || user.username, 120)
    || !exactText(user.residentId, 120)) {
    fail("RESIDENT_ACCESS_EVENT_SCOPE_DENIED", 403);
  }
  if (!exactText(accessLogId, 160)) fail("RESIDENT_ACCESS_EVENT_INVALID", 400);
  if (!Array.isArray(data?.residents)
    || data.residents.filter((row) => row?.id === user.residentId).length !== 1) {
    fail("RESIDENT_ACCESS_EVENT_INVALID", 409);
  }
  let intact = false;
  try { intact = verifyAuditTrail(data?.dataAccessLogs).passed === true; } catch { /* fail closed */ }
  if (!intact) fail("RESIDENT_ACCESS_EVENT_INVALID", 409);
  const events = data.dataAccessLogs.filter((row) => row?.id === accessLogId);
  if (events.length === 0) fail("RESIDENT_ACCESS_EVENT_INVALID", 404);
  if (events.length !== 1) fail("RESIDENT_ACCESS_EVENT_INVALID", 409);
  const event = events[0];
  if (!exactText(event.residentId, 120)
    || ["at", "actor", "role", "scope", "purpose", "result"].some((field) => !exactText(event[field], 4000))
    || !Number.isFinite(Date.parse(event.at))) {
    fail("RESIDENT_ACCESS_EVENT_INVALID", 409);
  }
  if (event.residentId !== user.residentId) fail("RESIDENT_ACCESS_EVENT_SCOPE_DENIED", 403);
  return Object.freeze({ schemaVersion: "resident-access-event.v1", accessLogId, residentId: user.residentId });
}

module.exports = { queryResidentAccessEvent };
