"use strict";

const BLOOD_EMERGENCY_COORDINATION_V1 = Object.freeze({
  id: "blood-emergency-coordination.v1",
  version: "1.0.0",
  consumer: "emergency",
  requiredFields: Object.freeze(["projectionId", "status", "occurredAt"])
});

const BLOOD_QUALITY_SIGNAL_V1 = Object.freeze({
  id: "blood-quality-signal.v1",
  version: "1.0.0",
  consumer: "quality-safety",
  requiredFields: Object.freeze(["eventId", "eventType", "status", "occurredAt"])
});

const CLINICAL_QUALITY_OBSERVATION_V1 = Object.freeze({
  id: "clinical-quality-observation.v1",
  version: "1.0.0",
  consumer: "quality-safety",
  requiredFields: Object.freeze(["sourceSubdomain", "subjectRef", "eventType", "status", "occurredAt"])
});

const CONTRACTS = Object.freeze([
  BLOOD_EMERGENCY_COORDINATION_V1,
  BLOOD_QUALITY_SIGNAL_V1,
  CLINICAL_QUALITY_OBSERVATION_V1
]);

function projectBloodObservation(event, consumer) {
  const common = {
    projectionId: `bmp-${event.id}-${consumer}`,
    eventId: event.id,
    eventType: event.type,
    sourceSubdomain: "blood",
    subjectRef: event.subjectId,
    consumer,
    status: "active",
    severity: event.severity,
    subjectId: event.subjectId,
    occurredAt: event.occurredAt,
    payload: event.payload
  };
  if (consumer === "quality-safety") {
    return {
      ...common,
      category: event.type.includes("reaction") ? "transfusion-reaction" : event.type.includes("recall") ? "blood-recall" : "cold-chain",
      workflow: "dispatch-rectify-review"
    };
  }
  if (consumer === "emergency") {
    return {
      ...common,
      category: event.type.includes("shortage") ? "blood-shortage" : event.type.includes("inventory") ? "blood-capacity" : "emergency-blood-request",
      workflow: "assess-allocate-dispatch"
    };
  }
  if (consumer === "operations") return { ...common, category: "blood-resource", workflow: "monitor-dispatch-reconcile" };
  return { ...common, category: "blood-governance-indicator", workflow: "aggregate-alert-review" };
}

module.exports = {
  BLOOD_EMERGENCY_COORDINATION_V1,
  BLOOD_QUALITY_SIGNAL_V1,
  CLINICAL_QUALITY_OBSERVATION_V1,
  CONTRACTS,
  projectBloodObservation
};
