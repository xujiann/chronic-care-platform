const {
  COORDINATION_ACTIONS,
  applyPublicHealthCoordinationAction,
  buildPublicHealthCoordinationCenter
} = require("./public-health-coordination-service");

const HANDOFF_STATES = new Set([
  "detected",
  "assigned",
  "in-progress",
  "receipt-confirmed",
  "exception-open",
  "closed",
  "reopened"
]);

const PERSISTED_OPERATIONAL_FIELDS = [
  "version",
  "state",
  "assignedTo",
  "dueAt",
  "receipt",
  "exception",
  "closure",
  "timeline",
  "lastAction",
  "businessClosureComplete"
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function clean(value) {
  return String(value ?? "").trim();
}

function persistedRows(data = {}) {
  return Array.isArray(data.publicHealthCoordinationHandoffs)
    ? data.publicHealthCoordinationHandoffs
    : [];
}

function isCompatiblePersistedHandoff(generated, persisted) {
  return Boolean(
    generated
    && persisted
    && clean(generated.id) === clean(persisted.id)
    && clean(generated.laneId) === clean(persisted.laneId)
    && clean(generated.businessKey) === clean(persisted.businessKey)
  );
}

function isValidPersistedOperationalState(persisted) {
  const version = Number(persisted?.version);
  const timeline = persisted?.timeline;
  if (!Number.isInteger(version) || version < 1 || !HANDOFF_STATES.has(clean(persisted?.state))) return false;
  if (!Array.isArray(timeline) || timeline.length > 30 || version < timeline.length + 1) return false;
  if (timeline.some((item) => !COORDINATION_ACTIONS[clean(item?.action)] || !clean(item?.idempotencyKey))) return false;
  if (persisted.state === "assigned" && (!clean(persisted.assignedTo) || !/^\d{4}-\d{2}-\d{2}/.test(clean(persisted.dueAt)))) return false;
  if (["receipt-confirmed", "closed"].includes(persisted.state) && clean(persisted.receipt?.status) !== "accepted") return false;
  if (persisted.state === "exception-open" && (clean(persisted.exception?.status) !== "open" || !clean(persisted.exception?.owner))) return false;
  if (persisted.businessClosureComplete && (persisted.state !== "closed" || !persisted.closure)) return false;
  if (persisted.state === "closed" && (!persisted.businessClosureComplete || !persisted.closure)) return false;
  return true;
}

function hydrateHandoff(generated, persisted) {
  if (!isCompatiblePersistedHandoff(generated, persisted) || !isValidPersistedOperationalState(persisted)) return clone(generated);
  const hydrated = clone(generated);
  PERSISTED_OPERATIONAL_FIELDS.forEach((field) => {
    if (persisted[field] !== undefined) hydrated[field] = clone(persisted[field]);
  });
  hydrated.version = Math.max(1, Number(hydrated.version) || 1);
  hydrated.timeline = Array.isArray(hydrated.timeline) ? hydrated.timeline.slice(-30) : [];
  hydrated.businessClosureComplete = Boolean(hydrated.businessClosureComplete);
  hydrated.productionReady = false;
  return hydrated;
}

function summarizeRuntime(center, handoffs, rejectedPersistedHandoffs) {
  const closedHandoffs = handoffs.filter((item) => item.state === "closed" && item.businessClosureComplete).length;
  return {
    ...clone(center.summary),
    handoffs: handoffs.length,
    openHandoffs: handoffs.length - closedHandoffs,
    closedHandoffs,
    auditEntries: handoffs.reduce((total, item) => total + (Array.isArray(item.timeline) ? item.timeline.length : 0), 0),
    restoredHandoffs: handoffs.filter((item) => Number(item.version) > 1).length,
    rejectedPersistedHandoffs
  };
}

function buildPublicHealthCoordinationRuntime({
  data = {},
  eventReporting = null,
  standardReview = null,
  center = null
} = {}) {
  const generated = center || buildPublicHealthCoordinationCenter({ data, eventReporting, standardReview });
  const persistedById = new Map(persistedRows(data).map((item) => [clean(item.id), item]));
  let rejectedPersistedHandoffs = 0;
  const handoffs = generated.handoffs.map((item) => {
    const persisted = persistedById.get(item.id);
    if (persisted && (!isCompatiblePersistedHandoff(item, persisted) || !isValidPersistedOperationalState(persisted))) rejectedPersistedHandoffs += 1;
    return hydrateHandoff(item, persisted);
  });
  const knownIds = new Set(generated.handoffs.map((item) => item.id));
  rejectedPersistedHandoffs += persistedRows(data).filter((item) => !knownIds.has(clean(item.id))).length;
  return {
    ...clone(generated),
    handoffs,
    summary: summarizeRuntime(generated, handoffs, rejectedPersistedHandoffs),
    functionalState: "eight-lane-coordination-persistence-ready",
    formalGoLiveState: "blocked-until-t00-route-writer-external-receipts-and-site-evidence-verified",
    productionReady: false,
    blockers: [
      "T00 must wire the public route and durable writer to this runtime controller.",
      "External signed receipts and trusted site evidence remain unverified."
    ]
  };
}

function buildAuditEntry(handoffId, result) {
  return {
    id: `${handoffId}:audit:${result.history.sequence}`,
    handoffId,
    laneId: result.handoff.laneId,
    action: result.history.action,
    from: result.history.from,
    to: result.history.to,
    version: result.handoff.version,
    actor: result.history.actor,
    role: result.history.role,
    at: result.history.at,
    idempotencyKey: result.history.idempotencyKey
  };
}

function applyPublicHealthCoordinationActionToState(
  data = {},
  handoffId,
  payload = {},
  user = {},
  dependencies = {}
) {
  const runtime = buildPublicHealthCoordinationRuntime({ data, ...dependencies });
  const index = runtime.handoffs.findIndex((item) => item.id === clean(handoffId));
  if (index < 0) throw new Error(`unknown public health coordination handoff: ${clean(handoffId) || "missing"}`);
  const result = applyPublicHealthCoordinationAction(runtime.handoffs[index], payload, user);
  const handoffs = runtime.handoffs.map((item, itemIndex) => itemIndex === index ? result.handoff : item);
  const existingAudit = Array.isArray(data.publicHealthCoordinationAudit)
    ? clone(data.publicHealthCoordinationAudit)
    : [];
  const audit = result.idempotent ? existingAudit : [...existingAudit, buildAuditEntry(handoffId, result)];
  const nextData = {
    ...data,
    publicHealthCoordinationHandoffs: clone(handoffs),
    publicHealthCoordinationAudit: audit
  };
  const nextRuntime = {
    ...runtime,
    handoffs: clone(handoffs),
    summary: summarizeRuntime(runtime, handoffs, runtime.summary.rejectedPersistedHandoffs),
    productionReady: false
  };
  return {
    ok: true,
    idempotent: result.idempotent,
    handoff: clone(result.handoff),
    action: clone(result.history),
    nextData,
    coordinationCenter: nextRuntime,
    productionReady: false
  };
}

module.exports = {
  PERSISTED_OPERATIONAL_FIELDS,
  applyPublicHealthCoordinationActionToState,
  buildPublicHealthCoordinationRuntime,
  hydrateHandoff,
  isCompatiblePersistedHandoff,
  isValidPersistedOperationalState
};
