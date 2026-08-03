"use strict";

const { createHash } = require("node:crypto");

const SESSION_SECURITY_AUDIT_CATEGORY = "session-security";
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

function digest(value) {
  return createHash("sha256").update(String(value || "")).digest("hex").slice(0, 24);
}

function requestPath(req) {
  return String(req?.url || "").split("?")[0].slice(0, 200);
}

function resolveCorrelationId(req, randomUUID) {
  const candidate = String(req?.correlationId || "").trim();
  return CORRELATION_ID_PATTERN.test(candidate) ? candidate : randomUUID();
}

function requestFingerprint(req) {
  const remoteAddress = String(req?.socket?.remoteAddress || "");
  const userAgent = String(req?.headers?.["user-agent"] || "");
  if (!remoteAddress && !userAgent) return "";
  return digest(`${remoteAddress}\n${userAgent}`);
}

function sessionReference(session) {
  return session?.sessionId ? digest(session.sessionId) : "";
}

function appendSessionSecurityAudit({
  req,
  session,
  event,
  readDatabase,
  writeDatabase,
  prependAuditTrailEntry,
  randomUUID,
  now = () => new Date()
}) {
  if (typeof readDatabase !== "function" || typeof writeDatabase !== "function") {
    throw new TypeError("session security audit requires database read and write capabilities");
  }
  if (typeof prependAuditTrailEntry !== "function" || typeof randomUUID !== "function") {
    throw new TypeError("session security audit requires audit-chain and identifier capabilities");
  }
  const data = readDatabase();
  const entry = {
    id: randomUUID(),
    at: now().toISOString(),
    category: SESSION_SECURITY_AUDIT_CATEGORY,
    schemaVersion: "session-security-audit/v1",
    correlationId: resolveCorrelationId(req, randomUUID),
    actor: String(event?.actor || "anonymous").slice(0, 120),
    role: String(event?.role || "anonymous").slice(0, 80),
    action: String(event?.action || "session-operation").slice(0, 120),
    target: String(event?.target || "unified-auth").slice(0, 160),
    result: String(event?.result || "recorded").slice(0, 40),
    detail: String(event?.detail || "").slice(0, 500),
    request: {
      method: String(req?.method || "GET").toUpperCase().slice(0, 12),
      path: requestPath(req)
    },
    clientFingerprint: requestFingerprint(req),
    sessionRef: sessionReference(session)
  };
  data.securityEvents = prependAuditTrailEntry(data.securityEvents, entry);
  writeDatabase(data);
  return entry;
}

function querySessionSecurityAudits(rows, {
  correlationId = "",
  action = "",
  result = "",
  limit = 50
} = {}) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 50));
  const normalizedCorrelationId = String(correlationId || "").trim();
  const normalizedAction = String(action || "").trim();
  const normalizedResult = String(result || "").trim();
  return (Array.isArray(rows) ? rows : [])
    .filter((item) => item?.category === SESSION_SECURITY_AUDIT_CATEGORY)
    .filter((item) => !normalizedCorrelationId || item.correlationId === normalizedCorrelationId)
    .filter((item) => !normalizedAction || item.action === normalizedAction)
    .filter((item) => !normalizedResult || item.result === normalizedResult)
    .slice(0, safeLimit);
}

function summarizeSessionSecurityAudits(rows) {
  const items = Array.isArray(rows) ? rows : [];
  return {
    total: items.length,
    allowed: items.filter((item) => item.result === "allowed").length,
    denied: items.filter((item) => item.result === "denied").length,
    partial: items.filter((item) => item.result === "partial").length,
    correlations: new Set(items.map((item) => item.correlationId).filter(Boolean)).size
  };
}

module.exports = {
  SESSION_SECURITY_AUDIT_CATEGORY,
  appendSessionSecurityAudit,
  querySessionSecurityAudits,
  summarizeSessionSecurityAudits
};
