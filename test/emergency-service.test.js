const assert = require("node:assert/strict");
const test = require("node:test");
const EmergencyService = require("../emergency-service");
const { buildEmergencyReadinessReport } = require("../scripts/emergency-readiness");

test("resident assisted call enters 120 acceptance queue without dispatching", () => {
  const data = EmergencyService.seed();
  const event = EmergencyService.createCall(data, { role:"citizen", name:"测试居民", residentId:"r1" }, { address:"大连市测试地址", chiefComplaint:"意识不清", latitude:38.9, longitude:121.6 });
  assert.equal(event.status, "accepted");
  assert.equal(event.mission, null);
  assert.match(event.timeline[0].note, /120人工确认调度/);
  assert.equal(data.emergencyAuditEvents.length, 1);
});

test("dispatch and clinical workflow is role scoped and ordered", () => {
  const data = EmergencyService.seed();
  const event = EmergencyService.createCall(data, { role:"citizen", name:"居民" }, { address:"测试地址", chiefComplaint:"呼吸困难" });
  EmergencyService.applyAction(data, { role:"commission", name:"120调度" }, event.id, { action:"dispatch", ambulanceId:"amb-120-02", etaMinutes:6 });
  assert.equal(event.status, "dispatched");
  assert.throws(() => EmergencyService.applyAction(data, { role:"institution", name:"车组" }, event.id, { action:"vehicle-update", status:"transporting" }), /状态必须按顺序推进/);
  for (const status of ["departed","arrived-scene","patient-contact","transporting"]) EmergencyService.applyAction(data, { role:"institution", name:"车组" }, event.id, { action:"vehicle-update", status });
  EmergencyService.applyAction(data, { role:"institution", name:"急救医生" }, event.id, { action:"clinical-update", systolic:150, diastolic:90, heartRate:105, spo2:95, preliminaryDiagnosis:"急性冠脉综合征" });
  assert.equal(event.clinical.vitals.at(-1).spo2, 95);
  assert.throws(() => EmergencyService.applyAction(data, { role:"citizen", name:"居民" }, event.id, { action:"hospital-confirm" }), /不能执行/);
});

test("hospital confirmation and WS/T 621 handover close the loop", () => {
  const data = EmergencyService.seed();
  const event = data.emergencyEvents[0];
  EmergencyService.applyAction(data, { role:"institution", name:"急救车组" }, event.id, { action:"vehicle-update", status:"arrived-hospital" });
  EmergencyService.applyAction(data, { role:"institution", name:"急诊医生" }, event.id, { action:"handover", hospitalVisitId:"ER-001", hospitalSigner:"王医生" });
  assert.equal(event.status, "handover-completed");
  assert.equal(event.handover.standard, "WS/T 621-2018");
  EmergencyService.applyAction(data, { role:"commission", name:"质控员" }, event.id, { action:"close" });
  assert.equal(event.status, "closed");
  assert.equal(data.emergencyResources.find((item)=>item.id==="amb-120-01").status, "available");
});

test("event evidence package shows completeness and WS/T 621 handover evidence", () => {
  const data = EmergencyService.seed();
  const event = data.emergencyEvents[0];
  const partial = EmergencyService.buildEvidencePackage(data, { role:"commission", name:"120 quality" }, event.id);
  assert.equal(partial.completeness.ready, false);
  assert.equal(partial.sections.find((item)=>item.id === "call").present, true);
  assert.equal(partial.sections.find((item)=>item.id === "hospital-receiving").present, true);
  assert.ok(partial.completeness.missing.includes("handover"));

  EmergencyService.applyAction(data, { role:"institution", name:"ambulance crew" }, event.id, { action:"vehicle-update", status:"arrived-hospital" });
  EmergencyService.applyAction(data, { role:"institution", name:"ER doctor" }, event.id, { action:"handover", hospitalVisitId:"ER-001", hospitalSigner:"Dr Wang" });
  EmergencyService.applyAction(data, { role:"commission", name:"quality officer" }, event.id, { action:"close" });
  const completed = EmergencyService.buildEvidencePackage(data, { role:"institution", name:"ER doctor" }, event.id);
  assert.equal(completed.completeness.ready, true);
  assert.ok(completed.standards.includes("WS/T 621-2018"));
  assert.equal(completed.sections.find((item)=>item.id === "audit").present, true);
});

test("citizens can only read their own emergency evidence package", () => {
  const data = EmergencyService.seed();
  const event = EmergencyService.createCall(data, { role:"citizen", name:"resident", residentId:"r-100" }, { address:"test address", chiefComplaint:"chest pain" });
  const ownPackage = EmergencyService.buildEvidencePackage(data, { role:"citizen", name:"resident", residentId:"r-100" }, event.id);
  assert.equal(ownPackage.eventId, event.id);
  assert.throws(() => EmergencyService.buildEvidencePackage(data, { role:"citizen", name:"other", residentId:"r-200" }, event.id), /cannot access/);
});

test("evidence exports bind the role-scoped package to a SHA-256 digest", () => {
  const data = EmergencyService.seed();
  const evidence = EmergencyService.buildEvidencePackage(data, { role:"commission", name:"quality" }, data.emergencyEvents[0].id);
  const json = EmergencyService.buildEvidenceExport(evidence, "json");
  const markdown = EmergencyService.buildEvidenceExport(evidence, "markdown");
  assert.match(json.integrity.digest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(json.contentType, "application/json; charset=utf-8");
  assert.match(json.body, /emergency-evidence-export-v1/);
  assert.equal(markdown.contentType, "text\/markdown; charset=utf-8");
  assert.match(markdown.body, /Prehospital emergency evidence package/);
  assert.throws(() => EmergencyService.buildEvidenceExport(evidence, "pdf"), /json or markdown/);
});

test("emergency readiness covers runnable UI, APIs, standards and site boundary", () => {
  const report = buildEmergencyReadinessReport();
  assert.equal(report.ok, true);
  assert.equal(report.functionalState, "ready-for-site-integration");
  assert.equal(report.formalGoLiveState, "blocked-until-site-evidence-signed");
  assert.equal(report.checks.every((item)=>item.passed), true);
  assert.equal(report.siteRequirements.length >= 5, true);
});
