"use strict";

const { createHash } = require("node:crypto");

const RECONCILIATION_STATES = Object.freeze([
  "discovered",
  "assigned",
  "acknowledged",
  "compensated",
  "independently-reviewed",
  "closed"
]);

const FINDING_TYPES = Object.freeze([
  "missing-receipt",
  "state-drift",
  "duplicate-receipt",
  "timeout",
  "dead-letter"
]);

const COMPENSATION_STRATEGIES = Object.freeze([
  "requery-receipt",
  "replay-delivery",
  "correct-projection",
  "quarantine-duplicate",
  "escalate-provider"
]);

const ACTOR_ROLES = Object.freeze([
  "commission-operations",
  "disease-control-office",
  "interface-operations",
  "hospital-information-center",
  "provider-operations",
  "disease-control-audit",
  "security-audit"
]);

const ASSIGNEE_ROLES = Object.freeze([
  "interface-operations",
  "hospital-information-center",
  "provider-operations"
]);

const SHA256 = /^[a-f0-9]{64}$/;
const AUDIT_GENESIS_DIGEST = "0".repeat(64);
const FORBIDDEN_KEYS = /(?:^|_)(?:payload|raw|body|resident|patient|subject|identity|idcard|name|phone|address|credential|token|secret|privatekey|signature)(?:$|_)/i;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function clean(value, maximum = 240) {
  return String(value ?? "").trim().replace(/[\r\n\t]+/g, " ").slice(0, maximum);
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

function reconciliationError(code, message, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}

function isoTime(value, label) {
  const parsed = Date.parse(clean(value, 80));
  if (!Number.isFinite(parsed)) {
    throw reconciliationError(
      "PUBLIC_HEALTH_DIRECT_REPORT_RECONCILIATION_TIME_INVALID",
      `${label} must be a valid date-time`
    );
  }
  return new Date(parsed).toISOString();
}

function optionalIsoTime(value, label) {
  return clean(value, 80) ? isoTime(value, label) : "";
}

function assertMinimalProjection(value, path = "projection") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertMinimalProjection(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  Object.entries(value).forEach(([key, item]) => {
    const normalized = key
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .replace(/[-\s]/g, "_");
    if (FORBIDDEN_KEYS.test(normalized)) {
      throw reconciliationError(
        "PUBLIC_HEALTH_DIRECT_REPORT_RECONCILIATION_SENSITIVE_PROJECTION",
        `${path}.${key} is not allowed in reconciliation projections`,
        422
      );
    }
    assertMinimalProjection(item, `${path}.${key}`);
  });
}

function normalizeCase(item = {}) {
  return {
    id: clean(item.id, 160),
    state: clean(item.state, 60).toLowerCase(),
    version: Math.max(0, Number(item.version || 0)),
    updatedAt: optionalIsoTime(item.updatedAt, "case updatedAt")
  };
}

function normalizeDelivery(item = {}) {
  const providerReceipt = item.providerReceipt && typeof item.providerReceipt === "object"
    ? {
      receiptId: clean(item.providerReceipt.receiptId, 200),
      providerStatus: clean(item.providerReceipt.providerStatus, 60).toLowerCase(),
      acceptedAt: optionalIsoTime(item.providerReceipt.acceptedAt, "provider receipt acceptedAt")
    }
    : null;
  return {
    id: clean(item.id, 160),
    caseId: clean(item.caseId, 160),
    state: clean(item.state, 60).toLowerCase(),
    version: Math.max(0, Number(item.version || 0)),
    updatedAt: optionalIsoTime(item.updatedAt, "delivery updatedAt"),
    nextAttemptAt: optionalIsoTime(item.nextAttemptAt, "delivery nextAttemptAt"),
    providerReceipt
  };
}

function normalizeReceipt(item = {}) {
  const receiptDigest = clean(item.receiptDigest, 64).toLowerCase();
  if (receiptDigest && !SHA256.test(receiptDigest)) {
    throw reconciliationError(
      "PUBLIC_HEALTH_DIRECT_REPORT_RECONCILIATION_RECEIPT_DIGEST_INVALID",
      "receiptDigest must be a SHA-256 digest",
      422
    );
  }
  return {
    id: clean(item.id, 200),
    deliveryId: clean(item.deliveryId, 160),
    caseId: clean(item.caseId, 160),
    status: clean(item.status, 60).toLowerCase(),
    receivedAt: optionalIsoTime(item.receivedAt, "receipt receivedAt"),
    receiptDigest
  };
}

function validateProjectionKeys(rows, required, label) {
  rows.forEach((row) => {
    required.forEach((key) => {
      if (!clean(row[key])) {
        throw reconciliationError(
          "PUBLIC_HEALTH_DIRECT_REPORT_RECONCILIATION_PROJECTION_INVALID",
          `${label} projection requires ${key}`,
          422
        );
      }
    });
  });
}

function findingSeverity(type) {
  if (["dead-letter", "state-drift"].includes(type)) return "critical";
  if (["timeout", "duplicate-receipt"].includes(type)) return "high";
  return "medium";
}

function makeFinding(type, delivery, detail, sourceDigest) {
  const binding = {
    type,
    caseId: clean(delivery.caseId, 160),
    deliveryId: clean(delivery.id, 160),
    detail: clean(detail, 120),
    sourceDigest
  };
  const findingDigest = sha256(stable(binding));
  return {
    id: `phdr-finding-${findingDigest.slice(0, 24)}`,
    type,
    severity: findingSeverity(type),
    caseRef: binding.caseId,
    deliveryRef: binding.deliveryId,
    detail: binding.detail,
    sourceDigest,
    findingDigest,
    productionReady: false
  };
}

function receiptStatus(receipt) {
  if (["accepted", "success", "confirmed"].includes(receipt.status)) return "accepted";
  if (["rejected", "failed"].includes(receipt.status)) return "rejected";
  return "unknown";
}

function addFinding(findings, seen, type, delivery, detail, sourceDigest) {
  const finding = makeFinding(type, delivery, detail, sourceDigest);
  if (!seen.has(finding.id)) {
    seen.add(finding.id);
    findings.push(finding);
  }
}

function scanDirectReportReconciliation(input = {}, options = {}) {
  assertMinimalProjection(input);
  const now = isoTime(options.now || new Date().toISOString(), "reconciliation scan time");
  const timeoutMinutes = Number(options.receiptTimeoutMinutes || 30);
  if (!Number.isInteger(timeoutMinutes) || timeoutMinutes < 1 || timeoutMinutes > 1440) {
    throw reconciliationError(
      "PUBLIC_HEALTH_DIRECT_REPORT_RECONCILIATION_TIMEOUT_INVALID",
      "receiptTimeoutMinutes must be an integer from 1 to 1440"
    );
  }
  const cases = (Array.isArray(input.cases) ? input.cases : []).map(normalizeCase);
  const deliveries = (Array.isArray(input.deliveries) ? input.deliveries : []).map(normalizeDelivery);
  const receipts = (Array.isArray(input.receipts) ? input.receipts : []).map(normalizeReceipt);
  validateProjectionKeys(cases, ["id", "state"], "case");
  validateProjectionKeys(deliveries, ["id", "caseId", "state"], "delivery");
  validateProjectionKeys(
    receipts,
    ["id", "deliveryId", "caseId", "status", "receivedAt", "receiptDigest"],
    "receipt"
  );

  const caseById = new Map(cases.map((item) => [item.id, item]));
  const receiptsByDelivery = new Map();
  receipts.forEach((receipt) => {
    if (!receiptsByDelivery.has(receipt.deliveryId)) receiptsByDelivery.set(receipt.deliveryId, []);
    receiptsByDelivery.get(receipt.deliveryId).push(receipt);
  });
  const findings = [];
  const seen = new Set();

  deliveries.forEach((delivery) => {
    const matching = receiptsByDelivery.get(delivery.id) || [];
    const uniqueReceipts = new Map(matching.map((receipt) => [
      `${receipt.id}:${receipt.receiptDigest}`,
      receipt
    ]));
    const sourceDigest = sha256(stable({
      case: caseById.get(delivery.caseId) || null,
      delivery,
      receipts: [...uniqueReceipts.values()].sort((left, right) => left.id.localeCompare(right.id))
    }));
    const referenceAt = delivery.providerReceipt?.acceptedAt || delivery.updatedAt;
    const timedOut = referenceAt
      && Date.parse(now) - Date.parse(referenceAt) >= timeoutMinutes * 60 * 1000;

    if (delivery.state === "dead-letter") {
      addFinding(findings, seen, "dead-letter", delivery, "delivery-entered-dead-letter", sourceDigest);
    }
    if (delivery.state === "awaiting-callback" && uniqueReceipts.size === 0) {
      addFinding(findings, seen, "missing-receipt", delivery, "provider-receipt-not-observed", sourceDigest);
      if (timedOut) {
        addFinding(findings, seen, "timeout", delivery, "callback-wait-exceeded", sourceDigest);
      }
    }
    if (
      delivery.state === "leased"
      && delivery.updatedAt
      && Date.parse(now) - Date.parse(delivery.updatedAt) >= timeoutMinutes * 60 * 1000
    ) {
      addFinding(findings, seen, "timeout", delivery, "worker-lease-stalled", sourceDigest);
    }
    if (
      delivery.state === "retry-scheduled"
      && delivery.nextAttemptAt
      && Date.parse(delivery.nextAttemptAt) <= Date.parse(now)
    ) {
      addFinding(findings, seen, "timeout", delivery, "retry-schedule-overdue", sourceDigest);
    }
    if (uniqueReceipts.size > 1) {
      addFinding(findings, seen, "duplicate-receipt", delivery, "multiple-distinct-receipts", sourceDigest);
    }
    if ([...uniqueReceipts.values()].some((receipt) => receipt.caseId !== delivery.caseId)) {
      addFinding(findings, seen, "state-drift", delivery, "receipt-case-binding-disagrees", sourceDigest);
    }

    const statuses = new Set([...uniqueReceipts.values()].map(receiptStatus).filter((status) => status !== "unknown"));
    const expectedDeliveryState = statuses.size === 1
      ? (statuses.has("accepted") ? "callback-accepted" : "callback-rejected")
      : "";
    if (
      expectedDeliveryState
      && ![expectedDeliveryState, "dead-letter"].includes(delivery.state)
    ) {
      addFinding(findings, seen, "state-drift", delivery, "receipt-and-delivery-state-disagree", sourceDigest);
    }
    if (statuses.size > 1) {
      addFinding(findings, seen, "state-drift", delivery, "receipt-statuses-conflict", sourceDigest);
    }
    const boundCase = caseById.get(delivery.caseId);
    if (!boundCase) {
      addFinding(findings, seen, "state-drift", delivery, "delivery-case-binding-not-found", sourceDigest);
    }
    if (
      boundCase
      && boundCase.state === "receipt-confirmed"
      && delivery.state !== "callback-accepted"
    ) {
      addFinding(findings, seen, "state-drift", delivery, "case-confirmed-without-accepted-callback", sourceDigest);
    }
    if (
      boundCase
      && delivery.state === "callback-accepted"
      && boundCase.state === "submitted"
    ) {
      addFinding(findings, seen, "state-drift", delivery, "accepted-callback-not-reflected-on-case", sourceDigest);
    }
  });
  const deliveryIds = new Set(deliveries.map((item) => item.id));
  receiptsByDelivery.forEach((items, deliveryId) => {
    if (deliveryIds.has(deliveryId)) return;
    const first = items[0];
    const orphan = { id: deliveryId, caseId: first.caseId };
    addFinding(
      findings,
      seen,
      "state-drift",
      orphan,
      "receipt-delivery-binding-not-found",
      sha256(stable(items))
    );
  });

  findings.sort((left, right) => (
    FINDING_TYPES.indexOf(left.type) - FINDING_TYPES.indexOf(right.type)
    || left.deliveryRef.localeCompare(right.deliveryRef)
    || left.id.localeCompare(right.id)
  ));
  const byType = Object.fromEntries(FINDING_TYPES.map((type) => [
    type,
    findings.filter((item) => item.type === type).length
  ]));
  return {
    scanAt: now,
    inputDigest: sha256(stable({ cases, deliveries, receipts })),
    findings,
    summary: {
      cases: cases.length,
      deliveries: deliveries.length,
      receipts: receipts.length,
      findings: findings.length,
      byType
    },
    rawPayloadPersisted: false,
    subjectIdentityPersisted: false,
    credentialsPersisted: false,
    signaturesPersisted: false,
    productionReady: false
  };
}

function stateFor(data = {}) {
  const nextData = clone(data);
  nextData.publicHealthDirectReportReconciliationCases = Array.isArray(
    nextData.publicHealthDirectReportReconciliationCases
  )
    ? nextData.publicHealthDirectReportReconciliationCases
    : [];
  return nextData;
}

function auditEventDigest(entry = {}) {
  return sha256(stable({
    sequence: Number(entry.sequence || 0),
    action: clean(entry.action, 60),
    at: clean(entry.at, 80),
    actorRole: clean(entry.actorRole, 120),
    actorDigest: clean(entry.actorDigest, 64),
    idempotencyKeyDigest: clean(entry.idempotencyKeyDigest, 64),
    intentDigest: clean(entry.intentDigest, 64),
    actionDigest: clean(entry.actionDigest, 64),
    previousDigest: clean(entry.previousDigest, 64)
  }));
}

function chainedAuditEntry(entry = {}, previousDigest = AUDIT_GENESIS_DIGEST) {
  const next = {
    ...entry,
    previousDigest
  };
  next.eventDigest = auditEventDigest(next);
  return next;
}

function verifyDirectReportReconciliationAudit(item = {}) {
  const entries = Array.isArray(item.auditSummary) ? item.auditSummary : [];
  if (!entries.length) {
    throw reconciliationError(
      "PUBLIC_HEALTH_DIRECT_REPORT_RECONCILIATION_AUDIT_INTEGRITY_INVALID",
      "reconciliation audit summary is missing",
      409
    );
  }
  let previousDigest = AUDIT_GENESIS_DIGEST;
  entries.forEach((entry, index) => {
    if (
      Number(entry.sequence) !== index + 1
      || clean(entry.previousDigest, 64) !== previousDigest
      || !SHA256.test(clean(entry.eventDigest, 64))
      || entry.eventDigest !== auditEventDigest(entry)
    ) {
      throw reconciliationError(
        "PUBLIC_HEALTH_DIRECT_REPORT_RECONCILIATION_AUDIT_INTEGRITY_INVALID",
        "reconciliation audit summary integrity verification failed",
        409
      );
    }
    previousDigest = entry.eventDigest;
  });
  return {
    valid: true,
    entries: entries.length,
    headDigest: previousDigest
  };
}

function discoveryAudit(finding, at) {
  return chainedAuditEntry({
    sequence: 1,
    action: "discover",
    at,
    actorRole: "reconciliation-scanner",
    actorDigest: sha256("reconciliation-scanner"),
    actionDigest: sha256(stable({
      action: "discover",
      findingDigest: finding.findingDigest,
      sourceDigest: finding.sourceDigest
    }))
  });
}

function discoverDirectReportReconciliationCases(data = {}, scan = {}) {
  const nextData = stateFor(data);
  const findings = Array.isArray(scan.findings) ? scan.findings : [];
  const at = isoTime(scan.scanAt || new Date().toISOString(), "reconciliation discovery time");
  const discovered = [];
  findings.forEach((finding) => {
    if (
      !FINDING_TYPES.includes(finding.type)
      || !SHA256.test(clean(finding.findingDigest, 64))
      || !SHA256.test(clean(finding.sourceDigest, 64))
    ) {
      throw reconciliationError(
        "PUBLIC_HEALTH_DIRECT_REPORT_RECONCILIATION_FINDING_INVALID",
        "reconciliation discovery requires a valid minimized finding",
        422
      );
    }
    const id = `phdr-reconciliation-${clean(finding.findingDigest, 64).slice(0, 24)}`;
    const existing = nextData.publicHealthDirectReportReconciliationCases.find((item) => item.id === id);
    if (existing) {
      verifyDirectReportReconciliationAudit(existing);
      if (existing.findingDigest !== finding.findingDigest || existing.sourceDigest !== finding.sourceDigest) {
        throw reconciliationError(
          "PUBLIC_HEALTH_DIRECT_REPORT_RECONCILIATION_FINDING_CONFLICT",
          "reconciliation finding binding has drifted",
          409
        );
      }
      discovered.push({ reconciliationCase: clone(existing), idempotent: true });
      return;
    }
    const reconciliationCase = {
      id,
      findingId: clean(finding.id, 160),
      findingType: finding.type,
      severity: clean(finding.severity, 40),
      caseRef: clean(finding.caseRef, 160),
      deliveryRef: clean(finding.deliveryRef, 160),
      findingDigest: clean(finding.findingDigest, 64),
      sourceDigest: clean(finding.sourceDigest, 64),
      status: "discovered",
      version: 1,
      assignment: null,
      acknowledgement: null,
      compensation: null,
      independentReview: null,
      closure: null,
      auditSummary: [discoveryAudit(finding, at)],
      createdAt: at,
      updatedAt: at,
      rawPayloadPersisted: false,
      subjectIdentityPersisted: false,
      credentialsPersisted: false,
      signaturesPersisted: false,
      productionReady: false
    };
    nextData.publicHealthDirectReportReconciliationCases.push(reconciliationCase);
    discovered.push({ reconciliationCase: clone(reconciliationCase), idempotent: false });
  });
  return { nextData, discovered, productionReady: false };
}

function findReconciliationCase(data, id) {
  const index = data.publicHealthDirectReportReconciliationCases.findIndex(
    (item) => item.id === clean(id, 160)
  );
  if (index < 0) {
    throw reconciliationError(
      "PUBLIC_HEALTH_DIRECT_REPORT_RECONCILIATION_NOT_FOUND",
      "direct-report reconciliation case was not found",
      404
    );
  }
  return { index, item: data.publicHealthDirectReportReconciliationCases[index] };
}

function actorBinding(input = {}) {
  const actorRole = clean(input.actorRole, 120);
  const actorId = clean(input.actorId, 160);
  if (!actorRole || !actorId) {
    throw reconciliationError(
      "PUBLIC_HEALTH_DIRECT_REPORT_RECONCILIATION_ACTOR_REQUIRED",
      "reconciliation action requires actorRole and actorId"
    );
  }
  if (!ACTOR_ROLES.includes(actorRole)) {
    throw reconciliationError(
      "PUBLIC_HEALTH_DIRECT_REPORT_RECONCILIATION_ACTOR_ROLE_INVALID",
      "reconciliation actorRole is not in the controlled role registry",
      403
    );
  }
  return { actorRole, actorDigest: sha256(`${actorRole}:${actorId}`) };
}

function evidenceBinding(input = {}) {
  const evidenceRef = clean(input.evidenceRef, 300);
  const evidenceDigest = clean(input.evidenceDigest, 64).toLowerCase();
  if (
    !/^(?:evidence|cmdb|audit|runbook|ticket|drill):\/\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+$/.test(evidenceRef)
    || !SHA256.test(evidenceDigest)
  ) {
    throw reconciliationError(
      "PUBLIC_HEALTH_DIRECT_REPORT_RECONCILIATION_EVIDENCE_REQUIRED",
      "reconciliation action requires a controlled evidence reference and SHA-256 digest",
      422
    );
  }
  return { evidenceRef, evidenceDigest };
}

function expectedStatus(action) {
  return {
    assign: "discovered",
    acknowledge: "assigned",
    compensate: "acknowledged",
    review: "compensated",
    close: "independently-reviewed"
  }[action] || "";
}

function targetStatus(action) {
  return {
    assign: "assigned",
    acknowledge: "acknowledged",
    compensate: "compensated",
    review: "independently-reviewed",
    close: "closed"
  }[action] || "";
}

function actionIntent(action, input, actor) {
  return {
    action,
    actorRole: actor.actorRole,
    actorDigest: actor.actorDigest,
    assigneeRole: clean(input.assigneeRole, 120),
    strategy: clean(input.strategy, 80),
    evidenceRef: clean(input.evidenceRef, 300),
    evidenceDigest: clean(input.evidenceDigest, 64).toLowerCase(),
    approved: input.approved === true,
    command: clean(input.command, 100)
  };
}

function applyDirectReportReconciliationActionToState(data = {}, id, input = {}) {
  const nextData = stateFor(data);
  const { index, item } = findReconciliationCase(nextData, id);
  verifyDirectReportReconciliationAudit(item);
  const action = clean(input.action, 60).toLowerCase();
  if (!expectedStatus(action)) {
    throw reconciliationError(
      "PUBLIC_HEALTH_DIRECT_REPORT_RECONCILIATION_ACTION_INVALID",
      "unsupported direct-report reconciliation action"
    );
  }
  const idempotencyKey = clean(input.idempotencyKey, 200);
  if (!idempotencyKey) {
    throw reconciliationError(
      "PUBLIC_HEALTH_DIRECT_REPORT_RECONCILIATION_IDEMPOTENCY_REQUIRED",
      "reconciliation action requires idempotencyKey"
    );
  }
  const actor = actorBinding(input);
  const keyDigest = sha256(idempotencyKey);
  const intentDigest = sha256(stable(actionIntent(action, input, actor)));
  const replay = item.auditSummary.find((entry) => entry.idempotencyKeyDigest === keyDigest);
  if (replay) {
    if (replay.action !== action || replay.intentDigest !== intentDigest) {
      throw reconciliationError(
        "PUBLIC_HEALTH_DIRECT_REPORT_RECONCILIATION_IDEMPOTENCY_CONFLICT",
        "reconciliation idempotency key was reused for a different action",
        409
      );
    }
    return { nextData, reconciliationCase: clone(item), idempotent: true };
  }
  const expectedVersion = Number(input.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion !== Number(item.version)) {
    throw reconciliationError(
      "PUBLIC_HEALTH_DIRECT_REPORT_RECONCILIATION_VERSION_CONFLICT",
      `reconciliation version conflict: expected ${expectedVersion}, current ${item.version}`,
      409
    );
  }
  if (item.status !== expectedStatus(action)) {
    throw reconciliationError(
      "PUBLIC_HEALTH_DIRECT_REPORT_RECONCILIATION_STATE_INVALID",
      `reconciliation action ${action} cannot run from ${item.status}`,
      409
    );
  }
  const at = isoTime(input.at || new Date().toISOString(), "reconciliation action time");
  const updated = clone(item);

  if (action === "assign") {
    const assigneeRole = clean(input.assigneeRole, 120);
    if (!ASSIGNEE_ROLES.includes(assigneeRole)) {
      throw reconciliationError(
        "PUBLIC_HEALTH_DIRECT_REPORT_RECONCILIATION_ASSIGNEE_ROLE_INVALID",
        "reconciliation assigneeRole is not in the controlled assignee registry",
        403
      );
    }
    updated.assignment = {
      assigneeRole,
      assignedByRole: actor.actorRole,
      assignedByDigest: actor.actorDigest,
      assignedAt: at
    };
  } else if (action === "acknowledge") {
    if (actor.actorRole !== item.assignment?.assigneeRole) {
      throw reconciliationError(
        "PUBLIC_HEALTH_DIRECT_REPORT_RECONCILIATION_ASSIGNEE_MISMATCH",
        "only the assigned role can acknowledge the reconciliation case",
        403
      );
    }
    updated.acknowledgement = {
      actorRole: actor.actorRole,
      actorDigest: actor.actorDigest,
      acknowledgedAt: at
    };
  } else if (action === "compensate") {
    if (actor.actorRole !== item.assignment?.assigneeRole) {
      throw reconciliationError(
        "PUBLIC_HEALTH_DIRECT_REPORT_RECONCILIATION_ASSIGNEE_MISMATCH",
        "only the assigned role can record compensation",
        403
      );
    }
    const strategy = clean(input.strategy, 80);
    if (!COMPENSATION_STRATEGIES.includes(strategy)) {
      throw reconciliationError(
        "PUBLIC_HEALTH_DIRECT_REPORT_RECONCILIATION_STRATEGY_INVALID",
        "reconciliation compensation strategy is invalid",
        422
      );
    }
    updated.compensation = {
      strategy,
      ...evidenceBinding(input),
      completedByRole: actor.actorRole,
      completedByDigest: actor.actorDigest,
      completedAt: at
    };
  } else if (action === "review") {
    if (
      actor.actorRole === item.assignment?.assigneeRole
      || actor.actorDigest === item.acknowledgement?.actorDigest
    ) {
      throw reconciliationError(
        "PUBLIC_HEALTH_DIRECT_REPORT_RECONCILIATION_INDEPENDENT_REVIEW_REQUIRED",
        "reconciliation review must be performed by an independent role and actor",
        403
      );
    }
    if (input.approved !== true) {
      throw reconciliationError(
        "PUBLIC_HEALTH_DIRECT_REPORT_RECONCILIATION_REVIEW_NOT_APPROVED",
        "reconciliation review must explicitly approve the compensation",
        422
      );
    }
    updated.independentReview = {
      approved: true,
      ...evidenceBinding(input),
      reviewerRole: actor.actorRole,
      reviewerDigest: actor.actorDigest,
      reviewedAt: at
    };
  } else if (action === "close") {
    if (clean(input.command, 100) !== "CLOSE DIRECT REPORT RECONCILIATION") {
      throw reconciliationError(
        "PUBLIC_HEALTH_DIRECT_REPORT_RECONCILIATION_CLOSE_CONFIRMATION_REQUIRED",
        "reconciliation closure requires the exact confirmation command",
        422
      );
    }
    if (
      actor.actorRole === item.assignment?.assigneeRole
      || actor.actorDigest === item.acknowledgement?.actorDigest
    ) {
      throw reconciliationError(
        "PUBLIC_HEALTH_DIRECT_REPORT_RECONCILIATION_INDEPENDENT_CLOSURE_REQUIRED",
        "reconciliation closure must be performed independently from compensation",
        403
      );
    }
    updated.closure = {
      ...evidenceBinding(input),
      closedByRole: actor.actorRole,
      closedByDigest: actor.actorDigest,
      closedAt: at
    };
  }

  updated.status = targetStatus(action);
  updated.version = Number(item.version) + 1;
  updated.updatedAt = at;
  updated.productionReady = false;
  const previousDigest = updated.auditSummary[updated.auditSummary.length - 1].eventDigest;
  updated.auditSummary.push(chainedAuditEntry({
    sequence: updated.auditSummary.length + 1,
    action,
    at,
    actorRole: actor.actorRole,
    actorDigest: actor.actorDigest,
    idempotencyKeyDigest: keyDigest,
    intentDigest,
    actionDigest: sha256(stable({
      previousVersion: item.version,
      nextVersion: updated.version,
      action,
      intentDigest
    }))
  }, previousDigest));
  verifyDirectReportReconciliationAudit(updated);
  nextData.publicHealthDirectReportReconciliationCases[index] = updated;
  return { nextData, reconciliationCase: clone(updated), idempotent: false };
}

function projectDirectReportReconciliationCase(item) {
  if (!item) return null;
  verifyDirectReportReconciliationAudit(item);
  return {
    id: clean(item.id, 160),
    findingType: FINDING_TYPES.includes(item.findingType) ? item.findingType : "unknown",
    severity: clean(item.severity, 40),
    caseRef: clean(item.caseRef, 160),
    deliveryRef: clean(item.deliveryRef, 160),
    status: RECONCILIATION_STATES.includes(item.status) ? item.status : "unknown",
    version: Number(item.version || 0),
    assigneeRole: clean(item.assignment?.assigneeRole, 120) || null,
    compensationStrategy: clean(item.compensation?.strategy, 80) || null,
    independentlyReviewed: item.independentReview?.approved === true,
    auditEntries: Array.isArray(item.auditSummary) ? item.auditSummary.length : 0,
    createdAt: clean(item.createdAt, 80),
    updatedAt: clean(item.updatedAt, 80),
    rawPayloadPersisted: false,
    subjectIdentityPersisted: false,
    credentialsPersisted: false,
    signaturesPersisted: false,
    productionReady: false
  };
}

function summarizeDirectReportReconciliations(data = {}) {
  const rows = (Array.isArray(data.publicHealthDirectReportReconciliationCases)
    ? data.publicHealthDirectReportReconciliationCases
    : []).map(projectDirectReportReconciliationCase);
  return {
    total: rows.length,
    open: rows.filter((item) => item.status !== "closed").length,
    closed: rows.filter((item) => item.status === "closed").length,
    criticalOpen: rows.filter((item) => item.status !== "closed" && item.severity === "critical").length,
    byState: Object.fromEntries(RECONCILIATION_STATES.map((status) => [
      status,
      rows.filter((item) => item.status === status).length
    ])),
    items: rows,
    productionReady: false
  };
}

module.exports = {
  ACTOR_ROLES,
  ASSIGNEE_ROLES,
  COMPENSATION_STRATEGIES,
  FINDING_TYPES,
  RECONCILIATION_STATES,
  applyDirectReportReconciliationActionToState,
  discoverDirectReportReconciliationCases,
  projectDirectReportReconciliationCase,
  reconciliationError,
  scanDirectReportReconciliation,
  sha256,
  summarizeDirectReportReconciliations,
  verifyDirectReportReconciliationAudit
};
