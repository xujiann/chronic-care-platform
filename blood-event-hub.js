const { randomUUID, createHash } = require("node:crypto");

const contracts = [
  { type: "blood.inventory.changed", producer: "blood", consumers: ["operations", "health-dashboard", "emergency"], standard: "regional-blood-event/1.0" },
  { type: "blood.shortage.detected", producer: "blood", consumers: ["emergency", "operations", "health-dashboard"], standard: "regional-blood-event/1.0" },
  { type: "blood.recall.opened", producer: "blood", consumers: ["quality-safety", "health-dashboard"], standard: "WS/T 867-2025+regional-blood-event/1.0" },
  { type: "blood.reaction.reported", producer: "blood", consumers: ["quality-safety", "health-dashboard"], standard: "WS/T 867-2025+regional-blood-event/1.0" },
  { type: "blood.cold-chain.breached", producer: "blood", consumers: ["quality-safety", "operations"], standard: "regional-blood-event/1.0" },
  { type: "blood.emergency.requested", producer: "blood", consumers: ["emergency", "operations", "health-dashboard"], standard: "regional-blood-event/1.0" }
];

function normalize(data) {
  data.bloodDomainEvents = Array.isArray(data.bloodDomainEvents) ? data.bloodDomainEvents : [];
  data.bloodEventDeliveries = Array.isArray(data.bloodEventDeliveries) ? data.bloodEventDeliveries : [];
  data.bloodModuleProjections = Array.isArray(data.bloodModuleProjections) ? data.bloodModuleProjections : [];
  return data;
}

function stableId(type, subjectId, version = "1") {
  return `bde-${createHash("sha256").update(`${type}|${subjectId}|${version}`).digest("hex").slice(0, 20)}`;
}

function inventoryRows(data) {
  const active = (data.bloodUnits || []).filter((x) => !["discarded", "recalled", "transfused"].includes(x.status));
  return [...new Set(active.map((x) => x.bloodType).filter(Boolean))].map((bloodType) => ({
    bloodType,
    available: active.filter((x) => x.bloodType === bloodType).length
  }));
}

function derive(data) {
  const rows = inventoryRows(data);
  const events = [{
    type: "blood.inventory.changed", subjectId: "regional-inventory", version: String(rows.reduce((n, x) => n + x.available, 0)), severity: "info", payload: { rows }
  }];
  rows.filter((x) => x.available < 2).forEach((x) => events.push({ type: "blood.shortage.detected", subjectId: x.bloodType, version: String(x.available), severity: "high", payload: x }));
  (data.bloodRecalls || []).filter((x) => x.status !== "closed").forEach((x) => events.push({ type: "blood.recall.opened", subjectId: x.id, version: String((x.acknowledgements || []).length), severity: "critical", payload: { recallId: x.id, status: x.status, bloodUnitIds: x.bloodUnitIds || [], affectedInstitutions: x.affectedInstitutions || [] } }));
  (data.transfusionReactions || []).filter((x) => x.status !== "closed").forEach((x) => events.push({ type: "blood.reaction.reported", subjectId: x.id, version: String(x.status), severity: x.severity === "严重" ? "critical" : "high", payload: { reactionId: x.id, institutionCode: x.institutionCode, bloodUnitIds: x.bloodUnitIds || [], status: x.status } }));
  (data.bloodSafetyIncidents || []).filter((x) => !["closed", "released", "discarded"].includes(x.status)).forEach((x) => events.push({ type: "blood.cold-chain.breached", subjectId: x.id, version: String(x.status), severity: "high", payload: { incidentId: x.id, shipmentId: x.shipmentId, bloodUnitIds: x.bloodUnitIds || [x.bloodUnitId].filter(Boolean), status: x.status } }));
  (data.emergencyBloodAllocations || []).filter((x) => !["completed", "cancelled"].includes(x.status)).forEach((x) => events.push({ type: "blood.emergency.requested", subjectId: x.id, version: String(x.status), severity: x.priority === "critical" ? "critical" : "high", payload: { allocationId: x.id, bloodType: x.bloodType, component: x.component, amount: x.amount, destinationInstitution: x.destinationInstitution, status: x.status } }));
  return events;
}

function projectionFor(event, consumer) {
  const common = { eventId: event.id, eventType: event.type, consumer, severity: event.severity, subjectId: event.subjectId, occurredAt: event.occurredAt, payload: event.payload };
  if (consumer === "quality-safety") return { ...common, category: event.type.includes("reaction") ? "transfusion-reaction" : event.type.includes("recall") ? "blood-recall" : "cold-chain", workflow: "dispatch-rectify-review" };
  if (consumer === "emergency") return { ...common, category: event.type.includes("shortage") ? "blood-shortage" : event.type.includes("inventory") ? "blood-capacity" : "emergency-blood-request", workflow: "assess-allocate-dispatch" };
  if (consumer === "operations") return { ...common, category: "blood-resource", workflow: "monitor-dispatch-reconcile" };
  return { ...common, category: "blood-governance-indicator", workflow: "aggregate-alert-review" };
}

function publish(data, actor, options = {}) {
  normalize(data);
  const now = new Date().toISOString();
  const created = [];
  const replayed = [];
  derive(data).forEach((source) => {
    const id = stableId(source.type, source.subjectId, source.version);
    let event = data.bloodDomainEvents.find((x) => x.id === id);
    if (event) { replayed.push(event.id); return; }
    const contract = contracts.find((x) => x.type === source.type);
    event = { id, schemaVersion: "1.0", producer: "blood", occurredAt: now, correlationId: String(options.correlationId || `blood-sync-${now}`), actor: actor.name || actor.username || "system", orgCode: actor.orgCode || "", ...source };
    data.bloodDomainEvents.unshift(event);
    contract.consumers.forEach((consumer) => {
      const delivery = { id: `bed-${randomUUID()}`, eventId: event.id, consumer, status: options.failConsumer === consumer ? "dead_letter" : "delivered", attempts: 1, createdAt: now, updatedAt: now, error: options.failConsumer === consumer ? "simulated_consumer_failure" : "" };
      data.bloodEventDeliveries.unshift(delivery);
      if (delivery.status === "delivered") data.bloodModuleProjections.unshift({ id: `bmp-${event.id}-${consumer}`, ...projectionFor(event, consumer), updatedAt: now });
    });
    created.push(event.id);
  });
  data.bloodDomainEvents = data.bloodDomainEvents.slice(0, 5000);
  data.bloodEventDeliveries = data.bloodEventDeliveries.slice(0, 10000);
  data.bloodModuleProjections = data.bloodModuleProjections.slice(0, 10000);
  return { created, replayed, correlationId: String(options.correlationId || `blood-sync-${now}`) };
}

function retry(data, actor, deliveryId) {
  normalize(data);
  const delivery = data.bloodEventDeliveries.find((x) => x.id === deliveryId);
  if (!delivery) return { status: 404, body: { error: "Not Found", message: "未找到事件投递记录" } };
  if (delivery.status !== "dead_letter") return { status: 409, body: { error: "Conflict", message: "只有死信投递可以重试" } };
  const event = data.bloodDomainEvents.find((x) => x.id === delivery.eventId);
  if (!event) return { status: 409, body: { error: "Conflict", message: "原始领域事件不存在" } };
  delivery.status = "delivered"; delivery.attempts += 1; delivery.updatedAt = new Date().toISOString(); delivery.error = ""; delivery.retriedBy = actor.name || actor.username;
  const projectionId = `bmp-${event.id}-${delivery.consumer}`;
  if (!data.bloodModuleProjections.some((x) => x.id === projectionId)) data.bloodModuleProjections.unshift({ id: projectionId, ...projectionFor(event, delivery.consumer), updatedAt: delivery.updatedAt });
  return { status: 200, body: { delivery, projection: data.bloodModuleProjections.find((x) => x.id === projectionId) } };
}

function dashboard(data, user) {
  normalize(data);
  const projections = data.bloodModuleProjections.filter((x) => user.role === "commission" || !x.payload?.institutionCode || x.payload.institutionCode === user.orgCode || x.payload.destinationInstitution === user.orgCode);
  return {
    contracts,
    summary: { contracts: contracts.length, events: data.bloodDomainEvents.length, delivered: data.bloodEventDeliveries.filter((x) => x.status === "delivered").length, deadLetters: data.bloodEventDeliveries.filter((x) => x.status === "dead_letter").length, projections: projections.length },
    events: data.bloodDomainEvents.slice(0, 100), deliveries: data.bloodEventDeliveries.slice(0, 200), projections: projections.slice(0, 200),
    consumers: ["emergency", "quality-safety", "operations", "health-dashboard"].map((id) => ({ id, records: projections.filter((x) => x.consumer === id).length, critical: projections.filter((x) => x.consumer === id && x.severity === "critical").length }))
  };
}

module.exports = { contracts, normalize, stableId, derive, projectionFor, publish, retry, dashboard };
