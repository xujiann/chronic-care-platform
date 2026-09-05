"use strict";

const { createHash, randomUUID: uuid } = require("node:crypto");
const CONTRACT_VERSION = "clinical-decision-support.v1";
const ACTIONS = new Set(["acknowledged", "accepted-recommendation", "adjusted-prescription", "cited-existing-diagnosis", "cited-existing-report", "dismissed-with-reason", "dismissed", "ignored", "rejected", "retained-with-reason", "keep-with-reason", "kept-order-with-reason"]);
const DISMISSALS = new Set(["dismissed-with-reason", "dismissed", "ignored", "rejected", "retained-with-reason", "keep-with-reason", "kept-order-with-reason"]);
const STATUSES = new Set(["received", "sent", "pending", "rejected"]);
const ALERT_FIELDS = ["id", "residentId", "residentName", "doctorId", "doctorName", "institution", "ruleId", "category", "alertTitle", "alertDetail", "severity", "sourceOrderNo", "linkedEvidenceId", "recommendation", "status", "doctorAction", "messageReceiptStatus", "pluginSurface", "serviceIntegrationStatus", "patientCenterStatus", "patientCenterRecordId", "dueAt", "lastAction", "receiptId", "lastReceiptAt", "version"];
const MANAGEMENT_ALERT_FIELDS = ["id", "ruleId", "category", "severity", "status", "doctorAction", "messageReceiptStatus", "pluginSurface", "serviceIntegrationStatus", "version"];
const RECEIPT_FIELDS = ["id", "alertId", "doctorId", "doctorName", "receiptStatus", "doctorAction", "actionDetail", "receivedAt", "messageChannel", "receivedBy", "auditHash"];
const MANAGEMENT_RECEIPT_FIELDS = ["id", "alertId", "receiptStatus", "doctorAction", "receivedAt", "messageChannel", "auditHash"];
const pick = (row, fields) => Object.fromEntries(fields.filter((field) => Object.hasOwn(row, field)).map((field) => [field, structuredClone(row[field])]));
const digest = (value) => createHash("sha256").update(value).digest("hex");
function fail(statusCode, code) { throw Object.assign(new Error(code), { statusCode, code }); }
function actorId(user) { return user && (user.id || user.userId || user.username); }
function requireActor(user) {
  if (!actorId(user) || !["commission", "institution"].includes(user.role)) fail(403, "CDSS_SCOPE_DENIED");
}
function text(value, fallback, max = 2000) {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !value.trim() || value.length > max) fail(400, "CDSS_INVALID_PAYLOAD");
  return value.trim();
}

/** T06 port. Identity/directory resolution and storage are trusted injected adapters. */
function createClinicalDecisionSupport(ports = {}) {
  const { seeds = {}, resolveOrganizationCode = (_data, row) => row.orgCode || row.institutionCode || "", now = () => new Date().toISOString(), hash = digest, randomUUID = uuid } = ports;
  let queue = Promise.resolve();
  const rows = (data, key, seed) => Array.isArray(data[key]) ? data[key] : (typeof seeds[seed] === "function" ? seeds[seed]() : []);
  function canAccessAlert(user, alert, data = {}) {
    if (!actorId(user) || !["commission", "institution"].includes(user.role)) return false;
    if (user.role === "commission") return true;
    const code = user.orgCode || user.institutionCode;
    if (typeof code !== "string" || !code) return false;
    const directory = Array.isArray(data.authOrganizations) ? data.authOrganizations : [];
    if (!directory.some((item) => (item.orgCode || item.code) === code)) return false;
    const resolved = resolveOrganizationCode(data, alert);
    if (resolved !== code) return false;
    if (user.accountType === "doctor" && !user.doctorId) return false;
    return !user.doctorId || (typeof user.doctorId === "string" && alert.doctorId === user.doctorId);
  }
  function projectAlert(alert, user) { return pick(alert, user.role === "commission" ? MANAGEMENT_ALERT_FIELDS : ALERT_FIELDS); }
  function projectReceipt(receipt, user) { return pick(receipt, user.role === "commission" ? MANAGEMENT_RECEIPT_FIELDS : RECEIPT_FIELDS); }
  function buildOverview(data, user) {
    requireActor(user);
    if (user.role === "institution" && !canAccessAlert(user, { orgCode: user.orgCode || user.institutionCode, doctorId: user.doctorId }, data)) fail(403, "CDSS_SCOPE_DENIED");
    const rules = rows(data, "phase2ClinicalAssistRules", "rules").map((row) => pick(row, ["id", "category", "name", "sourceSystem", "triggerCondition", "severity", "defaultAction", "requiredFields", "configStatus", "owner", "version"]));
    const alerts = rows(data, "phase2ClinicalAssistAlerts", "alerts").filter((row) => canAccessAlert(user, row, data));
    const ids = new Set(alerts.map((row) => row.id));
    const receipts = rows(data, "phase2ClinicalAssistReceipts", "receipts").filter((row) => ids.has(row.alertId));
    const contracts = rows(data, "phase2ClinicalAssistPluginContracts", "pluginContracts").map((row) => pick(row, ["id", "name", "endpoint", "surface", "payloadFields", "status", "onsiteBlocker"]));
    const categories = [...new Set(rules.map((row) => row.category))];
    const pending = (row) => /pending|待/i.test(`${row.status || ""} ${row.messageReceiptStatus || ""}`);
    const acknowledged = (row) => /acknowledged|received|已/i.test(`${row.status || ""} ${row.messageReceiptStatus || ""}`);
    const stats = categories.map((category) => {
      const scoped = alerts.filter((row) => row.category === category);
      return { category, alerts: scoped.length, pending: scoped.filter(pending).length, acknowledged: scoped.filter(acknowledged).length, doctors: user.role === "commission" ? [] : [...new Set(scoped.map((row) => row.doctorName).filter(Boolean))] };
    });
    const onsiteBlockers = [
      { id: "phase2-clinical-assist-his-plugin", owner: "hospital-integration", status: "onsite-blocked", blocker: "真实工作站、单点登录及消息回执仍待现场联调。" },
      { id: "phase2-clinical-assist-rule-signoff", owner: "medical-quality-center", status: "onsite-blocked", blocker: "正式规则、灰度范围和医生签名仍待独立审批。" }
    ];
    const ruleIds = new Set(rules.map((row) => row.id));
    const checks = [
      { id: "phase2ClinicalAssist:ruleConfig", passed: rules.length > 0 && rules.every((row) => row.requiredFields?.length && row.defaultAction && row.configStatus), detail: `${rules.length} rule configs` },
      { id: "phase2ClinicalAssist:alertQueue", passed: alerts.every((row) => ruleIds.has(row.ruleId) && row.residentId && row.doctorId && row.pluginSurface), detail: `${alerts.length} scoped alerts` },
      { id: "phase2ClinicalAssist:doctorWorkstation", passed: alerts.every((row) => row.serviceIntegrationStatus && row.recommendation), detail: `${new Set(alerts.map((row) => row.doctorId)).size} scoped workstations` },
      { id: "phase2ClinicalAssist:messageReceipts", passed: receipts.every((row) => row.auditHash), detail: `${receipts.length} scoped receipts` },
      { id: "phase2ClinicalAssist:pluginContracts", passed: contracts.length > 0 && contracts.every((row) => row.endpoint && row.payloadFields?.length && row.status), detail: `${contracts.length} contracts` },
      { id: "phase2ClinicalAssist:supervisionStats", passed: stats.length > 0, detail: `${stats.length} categories` },
      { id: "phase2ClinicalAssist:onsiteBoundary", passed: true, detail: "2 external evidence requirements" }
    ].map((row) => ({ ...row, passed: Boolean(row.passed) }));
    return { ok: checks.every((row) => row.passed), contractVersion: CONTRACT_VERSION, productionReady: false, generatedAt: now(), summary: { rules: rules.length, alerts: alerts.length, scopedAlerts: alerts.length, pendingAlerts: alerts.filter(pending).length, acknowledged: alerts.filter(acknowledged).length, receipts: receipts.length, pluginContracts: contracts.length, categories: categories.length, onsiteBlockers: onsiteBlockers.length }, rules, alerts: alerts.map((row) => projectAlert(row, user)), receipts: receipts.map((row) => projectReceipt(row, user)), pluginContracts: contracts, ruleConfig: rules.map((row) => ({ ruleId: row.id, category: row.category, status: row.configStatus, severity: row.severity, owner: row.owner, requiredFields: row.requiredFields || [], defaultAction: row.defaultAction })), supervisionStats: stats, onsiteBlockers, checks };
  }
  async function commitReceipt({ alertId, payload = {}, user, idempotencyKey }) {
    requireActor(user);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) fail(400, "CDSS_INVALID_PAYLOAD");
    const key = idempotencyKey === undefined ? payload.idempotencyKey : idempotencyKey;
    if (key !== undefined && (typeof key !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(key))) fail(400, "CDSS_INVALID_IDEMPOTENCY_KEY");
    if (idempotencyKey !== undefined && payload.idempotencyKey !== undefined && payload.idempotencyKey !== idempotencyKey) fail(400, "CDSS_INVALID_IDEMPOTENCY_KEY");
    const expectedVersion = payload.expectedVersion;
    if (expectedVersion !== undefined && (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0)) fail(400, "CDSS_INVALID_VERSION");
    const doctorAction = text(payload.doctorAction ?? payload.action, "acknowledged", 64);
    const receiptStatus = text(payload.receiptStatus ?? payload.status, "received", 32);
    if (!ACTIONS.has(doctorAction) || !STATUSES.has(receiptStatus)) fail(400, "CDSS_INVALID_ACTION");
    const detail = payload.actionDetail ?? payload.detail;
    if ((DISMISSALS.has(doctorAction) || receiptStatus === "rejected") && (typeof detail !== "string" || detail.trim().length < 8)) fail(400, "CDSS_REASON_REQUIRED");
    const actionDetail = text(detail, "医生工作站提醒回执已登记。");
    const messageChannel = text(payload.messageChannel, "doctor-workstation", 128);
    const source = await ports.readDatabase();
    const data = structuredClone(source);
    const alerts = rows(data, "phase2ClinicalAssistAlerts", "alerts").map((row) => structuredClone(row));
    const index = alerts.findIndex((row) => row.id === alertId);
    if (index < 0) fail(404, "CDSS_ALERT_NOT_FOUND");
    const alert = alerts[index];
    if (!canAccessAlert(user, alert, data)) fail(403, "CDSS_SCOPE_DENIED");
    const existing = rows(data, "phase2ClinicalAssistReceipts", "receipts").map((row) => structuredClone(row));
    const binding = digest(JSON.stringify([actorId(user), user.role, user.orgCode || user.institutionCode || "", user.doctorId || "", alertId, key]));
    const fingerprint = digest(JSON.stringify({ doctorAction, receiptStatus, actionDetail, messageChannel, expectedVersion }));
    if (key !== undefined) {
      const replay = existing.find((row) => row.commandMetadata?.binding === binding);
      if (replay) {
        if (replay.commandMetadata.fingerprint !== fingerprint) fail(409, "CDSS_IDEMPOTENCY_CONFLICT");
        const savedIds = replay.commandMetadata.response.overview.alerts.map((row) => row.id);
        if (!savedIds.every((id) => alerts.some((row) => row.id === id && canAccessAlert(user, row, data)))) fail(403, "CDSS_SCOPE_DENIED");
        return structuredClone(replay.commandMetadata.response);
      }
    }
    const version = alert.version === undefined ? 0 : alert.version;
    if (!Number.isSafeInteger(version) || version < 0 || version >= Number.MAX_SAFE_INTEGER) fail(409, "CDSS_INVALID_RESOURCE_VERSION");
    if (expectedVersion !== undefined && expectedVersion !== version) fail(409, "CDSS_VERSION_CONFLICT");
    const receivedAt = now();
    const receipt = { id: key === undefined ? `p2car-${alertId}` : `p2car-${binding}`, alertId, doctorId: alert.doctorId, doctorName: alert.doctorName || user.name || "", receiptStatus, doctorAction, actionDetail, receivedAt, messageChannel, receivedBy: actorId(user), auditHash: hash(`${alertId}/${doctorAction}/${receiptStatus}/${receivedAt}`) };
    alerts[index] = { ...alert, status: DISMISSALS.has(doctorAction) || receiptStatus === "rejected" ? "dismissed-with-reason" : "acknowledged", doctorAction, messageReceiptStatus: receiptStatus, receiptId: receipt.id, lastAction: actionDetail, lastReceiptAt: receivedAt, version: version + 1 };
    data.phase2ClinicalAssistAlerts = alerts;
    data.phase2ClinicalAssistReceipts = [...existing.filter((row) => row.id !== receipt.id), receipt];
    const result = { alert: projectAlert(alerts[index], user), receipt: projectReceipt(receipt, user), overview: buildOverview(data, user), contractVersion: CONTRACT_VERSION, productionReady: false };
    if (key !== undefined) receipt.commandMetadata = { contractVersion: CONTRACT_VERSION, binding, fingerprint, response: structuredClone(result) };
    try {
      const events = data.securityEvents === undefined ? [] : data.securityEvents;
      if (!(await ports.verifyAuditTrail(events))?.passed) fail(503, "CDSS_AUDIT_INVALID");
      data.securityEvents = await ports.prependAuditTrailEntry(events, { id: randomUUID(), at: receivedAt, actor: actorId(user), role: user.role, action: "phase2-clinical-assist-receipt", target: alertId, result: "allowed", detail: `${doctorAction}/${receiptStatus}/v${version + 1}` }, 120);
      if (!(await ports.verifyAuditTrail(data.securityEvents))?.passed) fail(503, "CDSS_AUDIT_INVALID");
      await ports.writeDatabase(data);
    } catch { fail(503, "CDSS_COMMIT_FAILED"); }
    return result;
  }
  function executeReceipt(command) {
    const result = queue.then(() => commitReceipt(command));
    queue = result.catch(() => {});
    return result;
  }
  return { contractVersion: CONTRACT_VERSION, canAccessAlert, buildOverview, executeReceipt };
}

module.exports = { CONTRACT_VERSION, createClinicalDecisionSupport };
