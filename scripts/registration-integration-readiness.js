#!/usr/bin/env node
const { readRuntimeSource } = require("../src/http/runtime-source");
const fs = require("node:fs");
const path = require("node:path");

const { normalizeRegistrationJourneyOrder } = require("./registration-journey-readiness");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "registration-integration-readiness-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "registration-integration-readiness-report.md");
const APPOINTMENT_CONTRACT_ID = "appointment-order-v1";
const CALLBACK_EVENT_TYPES = [
  "payment-succeeded",
  "payment-failed",
  "his-confirmed",
  "insurance-confirmed",
  "checked-in",
  "completed",
  "refund-completed",
  "refund-failed"
];

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function check(id, passed, detail) {
  return { id, passed: Boolean(passed), detail };
}

function callbackValue(payload, key) {
  if (payload?.[key] !== undefined) return payload[key];
  return payload?.payload?.[key];
}

function callbackRoleAllowed(eventType, role) {
  const roles = {
    "payment-succeeded": ["commission", "institution"],
    "payment-failed": ["commission", "institution"],
    "his-confirmed": ["commission", "institution"],
    "insurance-confirmed": ["commission", "insurance"],
    "checked-in": ["commission", "institution"],
    completed: ["commission", "institution"],
    "refund-completed": ["commission", "institution"],
    "refund-failed": ["commission", "institution"]
  };
  return (roles[eventType] || []).includes(role);
}

function findRegistrationOrderIndex(orders, payload) {
  const orderNo = String(callbackValue(payload, "orderNo") || "").trim();
  const residentId = String(callbackValue(payload, "residentId") || "").trim();
  return orders.findIndex((order) => {
    const identifiers = [order.id, order.registrationNo, order.hisVisitId, order.paymentTradeNo, order.insurancePrecheckNo].map((item) => String(item || ""));
    return identifiers.includes(orderNo) && (!residentId || order.residentId === residentId);
  });
}

function requireCallbackState(condition, message) {
  if (!condition) throw new Error(message);
}

function applyRegistrationIntegrationCallback(orders = [], payload = {}, eventMeta = {}, user = {}) {
  const eventType = String(callbackValue(payload, "eventType") || "").trim();
  const orderNo = String(callbackValue(payload, "orderNo") || "").trim();
  const occurredAt = String(callbackValue(payload, "occurredAt") || eventMeta.receivedAt || "").trim();
  if (!CALLBACK_EVENT_TYPES.includes(eventType)) throw new Error("unsupported appointment callback eventType");
  if (!orderNo) throw new Error("orderNo is required");
  if (!occurredAt) throw new Error("occurredAt is required");
  if (!callbackRoleAllowed(eventType, user.role)) throw new Error(`role ${user.role || "unknown"} cannot submit ${eventType}`);

  const rows = orders.map((item) => ({ ...item }));
  const index = findRegistrationOrderIndex(rows, payload);
  if (index < 0) throw new Error("registration order not found for callback");
  const current = normalizeRegistrationJourneyOrder(rows[index]);
  if (user.role === "institution") {
    const actorOrgCode = String(user.orgCode || "").trim();
    const targetOrgCode = String(current.hospitalCode || "").trim();
    if (!actorOrgCode) throw new Error("registration callback institution orgCode is required");
    if (!targetOrgCode || actorOrgCode !== targetOrgCode) throw new Error("registration callback scope denied");
  }

  const next = { ...current };
  const paymentReady = ["paid", "paid-demo", "waived"].includes(next.paymentStatus);
  const hospitalConfirmed = ["confirmed", "confirmed-demo"].includes(next.hisConfirmationStatus);
  const checkedIn = ["checked-in", "checked-in-demo"].includes(next.checkInStatus);

  if (eventType === "payment-succeeded") {
    requireCallbackState(!["cancelled", "completed", "closed"].includes(next.status), "payment callback is not allowed after closure");
    next.paymentStatus = "paid";
    next.paymentReceiptNo = String(callbackValue(payload, "receiptNo") || payload.externalId || eventMeta.externalId || "").trim();
    next.paidAt = occurredAt;
    next.journeyStage = "payment-recorded-callback";
  }
  if (eventType === "payment-failed") {
    requireCallbackState(!["cancelled", "completed", "closed"].includes(next.status), "payment failure is not allowed after closure");
    next.paymentStatus = "failed";
    next.paymentFailureCode = String(callbackValue(payload, "failureCode") || "upstream-payment-failed").trim();
    next.journeyStage = "payment-failed-callback";
  }
  if (eventType === "his-confirmed") {
    requireCallbackState(!["cancelled", "completed", "closed"].includes(next.status) && paymentReady, "HIS confirmation requires an open order with payment evidence");
    next.hisConfirmationStatus = "confirmed";
    next.hisConfirmedAt = occurredAt;
    next.hisCallbackNo = String(payload.externalId || eventMeta.externalId || "").trim();
    next.journeyStage = "hospital-confirmed-callback";
  }
  if (eventType === "insurance-confirmed") {
    next.insuranceStatus = "confirmed";
    next.insuranceConfirmationNo = String(callbackValue(payload, "settlementNo") || payload.externalId || eventMeta.externalId || "").trim();
    next.insuranceConfirmedAt = occurredAt;
    next.insuranceCoverage = Number(callbackValue(payload, "coverage") || next.insuranceCoverage || 0);
    next.journeyStage = hospitalConfirmed ? "hospital-confirmed-callback" : next.journeyStage;
  }
  if (eventType === "checked-in") {
    requireCallbackState(!["cancelled", "completed", "closed"].includes(next.status) && paymentReady && hospitalConfirmed, "check-in callback requires an open order with payment and HIS confirmation");
    next.checkInStatus = "checked-in";
    next.checkedInAt = occurredAt;
    next.checkInNo = String(callbackValue(payload, "checkInNo") || payload.externalId || eventMeta.externalId || "").trim();
    next.journeyStage = "checked-in-callback";
  }
  if (eventType === "completed") {
    requireCallbackState(!["cancelled", "completed", "closed"].includes(next.status) && checkedIn, "completion callback requires an open checked-in order");
    next.status = "completed";
    next.completedAt = occurredAt;
    next.completionNo = String(callbackValue(payload, "completionNo") || payload.externalId || eventMeta.externalId || "").trim();
    next.journeyStage = "completed-callback";
  }
  if (eventType === "refund-completed") {
    requireCallbackState(next.status === "cancelled" && ["refund-pending", "refund-failed"].includes(next.refundStatus), "refund callback requires a cancelled refund-pending order");
    next.paymentStatus = "refunded";
    next.refundStatus = "refunded";
    next.refundReceiptNo = String(callbackValue(payload, "receiptNo") || payload.externalId || eventMeta.externalId || "").trim();
    next.refundedAt = occurredAt;
    next.journeyStage = "cancelled-refunded-callback";
  }
  if (eventType === "refund-failed") {
    requireCallbackState(next.status === "cancelled" && next.refundStatus === "refund-pending", "refund failure requires a cancelled refund-pending order");
    next.refundStatus = "refund-failed";
    next.refundFailureCode = String(callbackValue(payload, "failureCode") || "upstream-refund-failed").trim();
    next.journeyStage = "cancelled-refund-failed-callback";
  }

  const actor = user.name || user.username || user.role || "integration-gateway";
  next.updatedAt = occurredAt;
  next.updatedBy = actor;
  next.productionReady = false;
  next.auditTrail = [
    {
      at: occurredAt,
      action: `integration-${eventType}`,
      by: actor,
      role: user.role || "integration",
      note: String(callbackValue(payload, "note") || `${APPOINTMENT_CONTRACT_ID} signed callback`).trim(),
      idempotencyKey: String(payload.idempotencyKey || eventMeta.idempotencyKey || "").trim(),
      externalId: String(payload.externalId || eventMeta.externalId || "").trim(),
      productionEvidence: false
    },
    ...(Array.isArray(next.auditTrail) ? next.auditTrail : [])
  ].slice(0, 40);
  rows[index] = next;

  return {
    orders: rows,
    order: next,
    receipt: {
      orderId: next.id,
      orderNo,
      eventType,
      hospitalCode: next.hospitalCode || "",
      landingStatus: "landed",
      reconciliationStatus: "matched",
      signatureVerified: true,
      productionEvidence: false
    }
  };
}

function scopeRegistrationIntegrationEvents(data, user = {}) {
  const orders = Array.isArray(data.registrationOrders) ? data.registrationOrders : [];
  const orderById = new Map(orders.map((item) => [item.id, item]));
  const orderByNumber = new Map(orders.flatMap((item) => [item.registrationNo, item.hisVisitId, item.paymentTradeNo, item.insurancePrecheckNo].filter(Boolean).map((value) => [value, item])));
  const orderForEvent = (item) => orderById.get(item.orderId) || orderByNumber.get(item.orderNo || item.requestPayload?.orderNo);
  const events = (Array.isArray(data.integrationGatewayEvents) ? data.integrationGatewayEvents : [])
    .filter((item) => item.contractId === APPOINTMENT_CONTRACT_ID);
  if (user.role === "institution") return events.filter((item) => item.hospitalCode === user.orgCode || orderForEvent(item)?.hospitalCode === user.orgCode);
  if (user.role === "insurance") return events.filter((item) => ["insurance-confirmed", "payment-succeeded", "payment-failed", "refund-completed", "refund-failed"].includes(item.eventType));
  if (user.role === "citizen") {
    const residentIds = new Set(Array.isArray(user.residentIds) ? user.residentIds : [user.residentId].filter(Boolean));
    return events.filter((item) => residentIds.has(item.residentId) || residentIds.has(orderForEvent(item)?.residentId));
  }
  return events;
}

function buildRegistrationIntegrationCenter(data = {}, user = {}) {
  const contracts = Array.isArray(data.integrationContracts) ? data.integrationContracts : [];
  const contract = contracts.find((item) => item.id === APPOINTMENT_CONTRACT_ID) || null;
  const events = scopeRegistrationIntegrationEvents(data, user);
  const schedules = (Array.isArray(data.registrationSchedules) ? data.registrationSchedules : [])
    .filter((item) => user.role !== "institution" || !user.orgCode || item.hospitalCode === user.orgCode);
  const sourceMap = new Map();
  schedules.forEach((schedule) => {
    const key = schedule.hospitalCode || schedule.sourceSystem || schedule.id;
    const current = sourceMap.get(key) || {
      id: key,
      hospitalCode: schedule.hospitalCode || "",
      hospital: schedule.hospital || schedule.sourceSystem || "Appointment source",
      sourceSystems: [],
      callbacks: 0,
      matchedCallbacks: 0,
      jointTestStatus: "pending-site-callback",
      productionReady: false
    };
    if (schedule.sourceSystem && !current.sourceSystems.includes(schedule.sourceSystem)) current.sourceSystems.push(schedule.sourceSystem);
    sourceMap.set(key, current);
  });
  events.forEach((event) => {
    const key = event.hospitalCode || "external-provider";
    const source = sourceMap.get(key) || {
      id: key,
      hospitalCode: event.hospitalCode || "",
      hospital: event.sourceInstitution || "External appointment provider",
      sourceSystems: [event.domain || "Appointment"],
      callbacks: 0,
      matchedCallbacks: 0,
      jointTestStatus: "pending-site-callback",
      productionReady: false
    };
    source.callbacks += 1;
    if (event.reconciliationStatus === "matched") source.matchedCallbacks += 1;
    source.lastCallbackAt = event.receivedAt || event.updatedAt || "";
    source.jointTestStatus = source.matchedCallbacks > 0 ? "callback-received-demo" : "callback-exception-open";
    sourceMap.set(key, source);
  });
  const sources = [...sourceMap.values()];
  const matched = events.filter((item) => item.reconciliationStatus === "matched").length;
  const deadLetters = events.filter((item) => item.deadLetter || item.status === "dead_letter" || item.status === "failed").length;
  const manualCases = events.filter((item) => item.manualReconciliation?.id);
  const openManualCases = manualCases.filter((item) => item.manualReconciliation?.status === "assigned");
  const resolvedManualCases = manualCases.filter((item) => item.manualReconciliation?.status === "resolved");
  const overdueManualCases = openManualCases.filter((item) => {
    const dueAt = String(item.manualReconciliation?.dueAt || "").trim();
    const dueTime = /^\d{4}-\d{2}-\d{2}$/.test(dueAt) ? Date.parse(`${dueAt}T23:59:59`) : Date.parse(dueAt);
    return Number.isFinite(dueTime) && dueTime < Date.now();
  });
  return {
    ok: true,
    status: "callback-center-onsite-blocked",
    contract,
    summary: {
      sources: sources.length,
      callbacks: events.length,
      matched,
      pendingReconciliation: events.filter((item) => !["matched", "manual-resolved"].includes(item.reconciliationStatus)).length,
      deadLetters,
      signatureVerified: events.filter((item) => item.signatureVerified).length,
      manualCases: manualCases.length,
      openManualCases: openManualCases.length,
      overdueManualCases: overdueManualCases.length,
      resolvedManualCases: resolvedManualCases.length,
      productionReady: 0,
      onsiteBlockers: 5
    },
    sources,
    events: events.slice(0, 40),
    blockers: [
      "live HIS, payment and insurance endpoint addresses and network allowlists",
      "non-placeholder gateway secret, machine identity and certificate rotation",
      "signed field mapping and callback status dictionary for every pilot institution",
      "full success, failure, retry, dead-letter and reconciliation joint-test evidence",
      "multi-party production cutover approval and rollback rehearsal"
    ],
    boundary: "本地签名回调仅证明契约、幂等、落库和对账能力；生产运行仍需真实端点、正式凭据、签署字典和现场验收证据。"
  };
}

function buildRegistrationIntegrationReadiness(options = {}) {
  const data = options.data || readJson(path.join("data", "db.json"));
  const pkg = options.pkg || readJson("package.json");
  const serverSource = options.serverSource ?? readRuntimeSource(ROOT);
  const interfaceMappingSource = options.interfaceMappingSource ?? readText(path.join("scripts", "interface-mapping.js"));
  const institutionSource = options.institutionSource ?? readText("institution.js");
  const institutionHtml = options.institutionHtml ?? readText("institution.html");
  const documentation = options.documentation ?? readText(path.join("docs", "registration-integration-center.md"));
  const manifestSource = options.manifestSource ?? readText(path.join("scripts", "release-artifact-manifest.js"));
  const deploySource = options.deploySource ?? readText(path.join("scripts", "deploy-check.js"));
  const releaseSource = options.releaseSource ?? readText(path.join("scripts", "release-report.js"));
  const center = buildRegistrationIntegrationCenter(data, { role: "commission" });
  const requiredFields = ["externalId", "residentId", "orderNo", "slotId", "eventType", "orderStatus", "occurredAt"];
  const checks = [
    check("registrationIntegration:contract", center.contract && requiredFields.every((field) => center.contract.requiredFields?.includes(field)) && center.contract.signature === "HMAC-SHA256" && center.contract.idempotencyKey === "externalId", center.contract ? `${center.contract.id} contract ready` : "appointment contract missing"),
    check("registrationIntegration:stateMachine", CALLBACK_EVENT_TYPES.length === 8 && CALLBACK_EVENT_TYPES.every((item) => documentation.includes(item)), "eight success and failure callbacks documented"),
    check("registrationIntegration:gateway", ["verifyIntegrationSignature", "idempotencyKey", "dead-letter", "applyRegistrationIntegrationCallback"].every((marker) => serverSource.includes(marker)), "signature, idempotency, landing and dead-letter paths are wired"),
    check("registrationIntegration:mapping", interfaceMappingSource.includes(`\"${APPOINTMENT_CONTRACT_ID}\"`) && interfaceMappingSource.includes("registrationOrders"), "appointment callback fields map to registrationOrders"),
    check("registrationIntegration:api", serverSource.includes("/api/registrations/integration-center") && serverSource.includes("buildRegistrationIntegrationCenter"), "role-scoped reconciliation API is wired"),
    check("registrationIntegration:remediation", serverSource.includes("/api/registrations/integration-events/:id/retry") && serverSource.includes("canManageAppointmentIntegrationEvent") && institutionSource.includes("data-registration-integration-retry") && institutionSource.includes("runInstitutionRegistrationIntegrationRetry") && documentation.includes("/api/registrations/integration-events/:id/retry"), "owning institution dead-letter retry, note and scope controls are wired"),
    check("registrationIntegration:manual-reconciliation", serverSource.includes("/api/registrations/integration-events/:id/reconciliation") && serverSource.includes("applyAppointmentIntegrationReconciliationAction") && institutionSource.includes("data-registration-reconciliation-action") && institutionSource.includes("runInstitutionRegistrationReconciliationAction") && documentation.includes("manual-compensation"), "manual case assignment, SLA, evidence resolution and reopen controls are wired"),
    check("registrationIntegration:institutionUi", institutionHtml.includes("registration-integration-center") && institutionSource.includes("renderRegistrationIntegrationCenter") && institutionSource.includes("registration-integration-events"), "institution callback and reconciliation center is visible"),
    check("registrationIntegration:productionBoundary", center.summary.productionReady === 0 && center.summary.onsiteBlockers >= 5 && center.sources.every((item) => item.productionReady === false), `production ready 0 / ${center.summary.onsiteBlockers} blockers`),
    check("registrationIntegration:releaseWiring", Boolean(pkg.scripts?.["registration:integration-readiness"]) && manifestSource.includes("registration-integration-readiness-report.md") && deploySource.includes("api:registrationIntegration") && releaseSource.includes("registrationIntegration:readiness"), "package, manifest, deploy and release gates are wired")
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    center,
    checks
  };
}

function renderMarkdown(report) {
  return [
    "# Registration integration readiness report",
    "",
    `- Status: ${report.ok ? "PASS" : "FAIL"}`,
    `- Sources / callbacks / matched: ${report.center.summary.sources} / ${report.center.summary.callbacks} / ${report.center.summary.matched}`,
    `- Pending reconciliation / dead letters: ${report.center.summary.pendingReconciliation} / ${report.center.summary.deadLetters}`,
    `- Production ready: ${report.center.summary.productionReady}`,
    "",
    "## Checks",
    "",
    "| Check | Result | Detail |",
    "|---|---|---|",
    ...report.checks.map((item) => `| ${item.id} | ${item.passed ? "PASS" : "FAIL"} | ${item.detail} |`),
    "",
    "## Production boundary",
    "",
    report.center.boundary,
    "",
    ...report.center.blockers.map((item) => `- ${item}`),
    ""
  ].join("\n");
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = { output: DEFAULT_OUTPUT, markdown: DEFAULT_MARKDOWN };
  argv.forEach((arg) => {
    if (arg.startsWith("--output=")) options.output = path.resolve(ROOT, arg.slice(9));
    if (arg.startsWith("--markdown=")) options.markdown = path.resolve(ROOT, arg.slice(11));
  });
  return options;
}

function writeOutput(report, options = {}) {
  const output = options.output ? path.resolve(ROOT, options.output) : DEFAULT_OUTPUT;
  const markdown = options.markdown ? path.resolve(ROOT, options.markdown) : DEFAULT_MARKDOWN;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.mkdirSync(path.dirname(markdown), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(markdown, `${renderMarkdown(report)}\n`, "utf8");
  return { output, markdown };
}

if (require.main === module) {
  const report = buildRegistrationIntegrationReadiness();
  writeOutput(report, parseArgs());
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.ok ? 0 : 1;
}

module.exports = {
  APPOINTMENT_CONTRACT_ID,
  CALLBACK_EVENT_TYPES,
  applyRegistrationIntegrationCallback,
  buildRegistrationIntegrationCenter,
  buildRegistrationIntegrationReadiness,
  callbackRoleAllowed,
  parseArgs,
  renderMarkdown,
  writeOutput
};
