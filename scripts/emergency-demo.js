const EmergencyService = require("../emergency-service");

const data = EmergencyService.seed();
const citizen = { role: "citizen", name: "Demo citizen", residentId: "demo-resident-001" };
const dispatcher = { role: "commission", name: "120 dispatcher" };
const crew = { role: "institution", name: "Ambulance crew" };
const hospital = { role: "institution", name: "Emergency department" };

const event = EmergencyService.createCall(data, citizen, {
  address: "Demo location, Zhongshan District",
  chiefComplaint: "Acute chest pain with sweating",
  triageLevel: "P1",
  latitude: 38.92,
  longitude: 121.65
});
EmergencyService.applyAction(data, dispatcher, event.id, { action: "dispatch", ambulanceId: "amb-120-02", etaMinutes: 6 });
for (const status of ["departed", "arrived-scene", "patient-contact", "transporting"]) {
  EmergencyService.applyAction(data, crew, event.id, { action: "vehicle-update", status });
}
EmergencyService.applyAction(data, crew, event.id, { action: "clinical-update", systolic: 158, diastolic: 96, heartRate: 108, respiratoryRate: 22, spo2: 94, preliminaryDiagnosis: "Acute coronary syndrome suspected" });
EmergencyService.applyAction(data, hospital, event.id, { action: "hospital-confirm", hospitalId: "hosp-central", greenChannel: "chest-pain" });
EmergencyService.applyAction(data, crew, event.id, { action: "vehicle-update", status: "arrived-hospital" });
EmergencyService.applyAction(data, hospital, event.id, { action: "handover", hospitalVisitId: "DEMO-ER-001", hospitalSigner: "ER receiver" });
EmergencyService.applyAction(data, dispatcher, event.id, { action: "close" });

const evidence = EmergencyService.buildEvidencePackage(data, dispatcher, event.id);
const exported = EmergencyService.buildEvidenceExport(evidence, "json");
console.log(JSON.stringify({
  demo: "citizen-call-to-hospital-handover",
  eventNo: event.eventNo,
  finalStatus: event.status,
  timelineSteps: event.timeline.length,
  evidenceCompleteness: evidence.completeness,
  handoverStandard: event.handover.standard,
  export: { filename: exported.filename, digest: exported.integrity.digest, canonicalization: exported.integrity.canonicalization },
  productionBoundary: evidence.releaseBoundary
}, null, 2));
