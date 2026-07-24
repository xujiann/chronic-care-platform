const { createHash } = require("node:crypto");
const EmergencyService = require("./emergency-service");
const DeviceGateway = require("./emergency-device-gateway");
const Production = require("./emergency-production");

const MODULE_ID = "emergency-life-chain";
const RECEIPT_CONFIRMATION = "ACCEPT EMERGENCY SITE RECEIPT";
const REQUIREMENT_ENDPOINT_CATEGORY = Object.freeze({
  "EMG-SITE-01":"cti", "EMG-SITE-02":"location", "EMG-SITE-03":"device",
  "EMG-SITE-04":"hospital", "EMG-SITE-06":"regional-platform"
});

function text(value, max = 300) { return String(value || "").trim().slice(0, max); }
function sha256(value) { return createHash("sha256").update(String(value)).digest("hex"); }
function validDigest(value) { return /^sha256:[a-f0-9]{64}$/i.test(text(value, 80)); }

function validateSiteEvidenceReceipt(data, receipt = {}) {
  Production.ensure(data);
  const requirementId = text(receipt.requirementId, 40);
  const requirement = data.emergencyLaunchRequirements.find((item)=>item.id === requirementId);
  const endpointCategory = REQUIREMENT_ENDPOINT_CATEGORY[requirementId];
  const endpoint = endpointCategory && data.emergencyIntegrationEndpoints.find((item)=>item.category === endpointCategory);
  const missing = ["receiptId","receiptRef","acceptedAt","receiver","externalSystem"].filter((field)=>!text(receipt[field]));
  if (text(receipt.confirmation, 80) !== RECEIPT_CONFIRMATION) missing.push("confirmation");
  if (!validDigest(receipt.evidenceDigest)) missing.push("evidenceDigest");
  const verified = Boolean(requirement && requirement.status === "signed" && receipt.evidenceDigest === requirement.evidenceDigest && requirement.verificationRef);
  const endpointReady = !endpoint || endpoint.productionReady === true;
  const accepted = receipt.outcome === "accepted";
  return {
    valid:missing.length === 0 && verified && endpointReady && accepted,
    moduleId:MODULE_ID,
    requirementId,
    receiptId:text(receipt.receiptId, 120),
    receiptDigest:`sha256:${sha256([text(receipt.receiptId), text(receipt.receiptRef), text(receipt.evidenceDigest), text(receipt.acceptedAt), text(receipt.receiver)].join("|"))}`,
    reasons:[
      ...missing.map((field)=>`missing-${field}`),
      ...(requirement ? [] : ["unknown-requirement"]),
      ...(verified ? [] : ["independent-site-evidence-not-verified"]),
      ...(endpointReady ? [] : ["related-endpoint-not-production-ready"]),
      ...(accepted ? [] : ["receipt-not-accepted"])
    ],
    formalGoLiveState:missing.length === 0 && verified && endpointReady && accepted ? "receipt-accepted" : "no-go-site-evidence-pending"
  };
}

function evaluateRollbackGate(data) {
  Production.ensure(data);
  const criticalIncidents = data.emergencyLaunchIncidents.filter((item)=>item.status !== "resolved" && ["P0","P1"].includes(item.severity));
  const failedObservations = data.emergencyGoLiveObservations.filter((item)=>item.status === "failed");
  const deadLetters = data.emergencyDeliveryQueue.filter((item)=>item.status === "dead-letter");
  const criticalAlerts = data.emergencyOperationalAlerts.filter((item)=>item.status !== "resolved" && ["P0","P1"].includes(item.severity));
  const triggers = [
    ...criticalIncidents.map((item)=>`launch-incident:${item.id}`),
    ...failedObservations.map((item)=>`failed-observation:${item.id}`),
    ...deadLetters.map((item)=>`delivery-dead-letter:${item.id}`),
    ...criticalAlerts.map((item)=>`critical-alert:${item.id}`)
  ];
  return {
    moduleId:MODULE_ID,
    decision:triggers.length ? "rollback-required" : "rollback-standby",
    triggers,
    actions:triggers.length ? ["stop-new-digital-dispatch","use-120-approved-fallback","preserve-audit-and-evidence","notify-command-and-hospital-duty"] : ["retain-120-fallback-on-standby","continue-observation"],
    formalGoLiveState:triggers.length ? "blocked-by-rollback-trigger" : "site-evidence-still-required"
  };
}

function runHandoverAcceptanceScenario(options = {}) {
  const data = { ...EmergencyService.seed(), ...Production.seed(), ...DeviceGateway.seed() };
  const citizen = { role:"citizen", name:"handover scenario resident", residentId:"scenario-resident" };
  const dispatcher = { role:"commission", name:"120 dispatch acceptance" };
  const crew = { role:"institution", name:"ambulance clinician", orgCode:"MR1" };
  const hospital = { role:"institution", name:"emergency receiving clinician", orgCode:"MR1" };
  const event = EmergencyService.createCall(data, citizen, { address:"Independent module acceptance site", chiefComplaint:"acute chest pain", triageLevel:"P1", latitude:38.92, longitude:121.65 });
  EmergencyService.applyAction(data, dispatcher, event.id, { action:"dispatch", ambulanceId:"amb-120-02", etaMinutes:8, note:"120 dispatch accepted" });
  for (const status of ["departed","arrived-scene","patient-contact"]) EmergencyService.applyAction(data, crew, event.id, { action:"vehicle-update", status });
  EmergencyService.applyAction(data, crew, event.id, { action:"clinical-update", preliminaryDiagnosis:"acute coronary syndrome suspected", systolic:160, diastolic:95, heartRate:104, respiratoryRate:22, spo2:95, source:"ambulance-monitor", treatment:"oxygen" });
  EmergencyService.applyAction(data, crew, event.id, { action:"vehicle-update", status:"transporting" });
  EmergencyService.applyAction(data, hospital, event.id, { action:"hospital-confirm", hospitalId:"hosp-central", greenChannel:"chest-pain", note:"receiving team confirmed" });
  EmergencyService.applyAction(data, crew, event.id, { action:"vehicle-update", status:"arrived-hospital" });
  EmergencyService.applyAction(data, hospital, event.id, { action:"handover", hospitalVisitId:"SCENARIO-ER-001", prehospitalSigner:"ambulance clinician", hospitalSigner:"emergency receiving clinician", note:"WS/T 621 acceptance scenario" });
  const evidence = EmergencyService.buildEvidencePackage(data, dispatcher, event.id);
  const required = ["dispatch","vehicle-track","clinical-record","hospital-receiving","handover"];
  const missing = required.filter((id)=>!evidence.sections.find((section)=>section.id === id)?.present);
  return { moduleId:MODULE_ID, scenarioId:"prehospital-to-hospital-handover", status:missing.length ? "failed" : "passed", eventId:event.id, finalStatus:event.status, standard:event.handover?.standard, evidenceDigest:EmergencyService.buildEvidenceExport(evidence, "json").integrity.digest, missing, independentDataOnly:true };
}

function buildIndependentModuleReadiness(data) {
  const center = Production.buildCenter(data);
  const rollback = evaluateRollbackGate(data);
  return {
    moduleId:MODULE_ID,
    deployment:"independent-emergency-module",
    crossModuleDependencies:[],
    runtimeDependencies:["node", "persistent-state-adapter", "shared-auth-adapter", "120-site-integration"],
    routeBinding:"T00 binds declared emergency routes in the shared server; this module does not alter server.js.",
    signatureContracts:DeviceGateway.INTEGRATION_CERTIFICATE_CONTRACTS,
    functionalState:"ready-for-independent-smoke",
    formalGoLiveState:center.formalGoLiveState,
    noGoReason:center.productionReady ? "" : "real site evidence, external receipts, drills and cutover approvals are not all complete",
    rollback
  };
}

module.exports = { MODULE_ID, RECEIPT_CONFIRMATION, buildIndependentModuleReadiness, evaluateRollbackGate, runHandoverAcceptanceScenario, validateSiteEvidenceReceipt };
