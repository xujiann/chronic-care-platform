const assert = require("node:assert/strict");
const test = require("node:test");
const Production = require("../emergency-production");

const commission = { role:"commission", name:"急救上线管理员" };

test("production center keeps functional readiness separate from site cutover", () => {
  const data = Production.seed();
  const center = Production.buildCenter(data);
  assert.equal(center.functionalReady, true);
  assert.equal(center.productionReady, false);
  assert.equal(center.summary.cutoverBlockers, 5);
  assert.equal(center.formalGoLiveState, "blocked-until-site-evidence-signed");
});

test("endpoint probe never self-signs production readiness", () => {
  const data = Production.seed();
  const endpoint = Production.probeEndpoint(data, commission, "emg-int-cti", { baseUrl:"https://cti.example", credentialRef:"secret/cti", latencyMs:28 });
  assert.equal(endpoint.status, "probe-passed-site-signoff-pending");
  assert.equal(endpoint.productionReady, false);
  assert.throws(()=>Production.signRequirement(data,commission,"EMG-SITE-01",{ confirmation:"wrong", evidenceRef:"evidence://cti", note:"joint test" }),/exact confirmation/);
  const submitted = Production.signRequirement(data,commission,"EMG-SITE-01",{ action:"submit-evidence", confirmation:Production.REQUIREMENT_CONFIRMATION, evidenceRef:"evidence://cti/signed", evidenceDigest:"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", externalSigner:"120 duty commander", externalOrganization:"120 emergency center", note:"120 center and vendor signed" });
  assert.equal(submitted.status,"evidence-submitted");
  assert.equal(endpoint.productionReady,false);
  assert.throws(()=>Production.signRequirement(data,commission,"EMG-SITE-01",{ action:"verify-evidence", confirmation:"VERIFY EMERGENCY SITE EVIDENCE", evidenceDigest:submitted.evidenceDigest, verificationRef:"evidence://cti/verify" }),/submitter cannot independently verify/);
  const signed = Production.signRequirement(data,{...commission,id:"u-security",name:"independent verifier"},"EMG-SITE-01",{ action:"verify-evidence", confirmation:"VERIFY EMERGENCY SITE EVIDENCE", evidenceDigest:submitted.evidenceDigest, verificationRef:"evidence://cti/verify" });
  assert.equal(signed.status,"signed");
  assert.equal(endpoint.productionReady,true);
});

test("delivery queue is idempotent and moves failed messages to dead letter", () => {
  const data=Production.seed();
  const first=Production.enqueue(data,commission,{eventId:"emg-2",channel:"hospital-prealert",idempotencyKey:"emg-2:prealert:v1",maxAttempts:2,body:{status:"transporting"}});
  const replay=Production.enqueue(data,commission,{eventId:"emg-2",channel:"hospital-prealert",idempotencyKey:"emg-2:prealert:v1",body:{status:"changed"}});
  assert.equal(first.idempotentReplay,false);assert.equal(replay.idempotentReplay,true);assert.equal(first.item.id,replay.item.id);
  Production.retryDelivery(data,commission,first.item.id,{error:"timeout"});
  Production.retryDelivery(data,commission,first.item.id,{error:"timeout"});
  assert.equal(first.item.status,"dead-letter");
});

test("drills require passed result and evidence", () => {
  const data=Production.seed();
  assert.throws(()=>Production.completeDrill(data,commission,"emg-drill-network",{result:"passed"}),/evidenceRef/);
  const drill=Production.completeDrill(data,commission,"emg-drill-network",{result:"passed",evidenceRef:"evidence://drill/network"});
  assert.equal(drill.productionEvidence,true);
  assert.equal(Production.buildCenter(data).summary.drillsPassed,1);
});

test("data quality detects missing handover and mission fields", () => {
  const data={...Production.seed(),emergencyEvents:[{id:"bad",eventNo:"120-x",source:"120-phone",location:{address:"test"},chiefComplaint:"test",status:"closed",createdAt:new Date().toISOString(),timeline:[]}]};
  const result=Production.validateEvent(data,commission,"bad");
  assert.equal(result.passed,false);assert.equal(result.issues.some((item)=>item.severity==="P0"),true);assert.equal(Production.buildCenter(data).summary.openP0Quality>0,true);
  const p0=result.issues.find((item)=>item.severity==="P0");
  assert.throws(()=>Production.resolveDataQualityIssue(data,commission,p0.id,{note:"fixed"}),/evidenceRef/);
  const resolved=Production.resolveDataQualityIssue(data,commission,p0.id,{note:"manual reconciliation completed",evidenceRef:"evidence://quality/bad"});
  assert.equal(resolved.status,"resolved");
  assert.equal(Production.buildCenter(data).dataQuality.issues.some((item)=>item.id===p0.id&&item.status==="resolved"),true);
});

test("operational alerts require evidence-bearing closure", () => {
  const data=Production.seed();
  data.emergencyOperationalAlerts.unshift({id:"alert-p1",source:"synthetic",severity:"P1",title:"hospital gateway latency",status:"open",detectedAt:new Date().toISOString(),acknowledgedAt:"",resolvedAt:"",owner:"",note:""});
  assert.equal(Production.buildCenter(data).summary.openCriticalAlerts,1);
  const acknowledged=Production.applyAlertAction(data,commission,"alert-p1",{action:"acknowledge",owner:"platform duty"});
  assert.equal(acknowledged.status,"acknowledged");
  assert.throws(()=>Production.applyAlertAction(data,commission,"alert-p1",{action:"resolve"}),/resolution note/);
  const resolved=Production.applyAlertAction(data,commission,"alert-p1",{action:"resolve",note:"latency returned to normal",owner:"platform duty"});
  assert.equal(resolved.status,"resolved");
  assert.equal(Production.buildCenter(data).summary.openCriticalAlerts,0);
});

test("cutover approval requires ready preflight and different signers", () => {
  const data=Production.seed();
  assert.throws(()=>Production.signCutoverApproval(data,commission,"emg-approval-business",{}),/preflight/);
  data.emergencyIntegrationEndpoints.forEach((item)=>{item.productionReady=true;item.status="ready"});data.emergencyDrills.forEach((item)=>{item.productionEvidence=true;item.status="passed"});data.emergencyLaunchRequirements.forEach((item)=>{item.status="signed"});
  data.emergencyProductionHandoffs.forEach((item)=>{item.status="accepted";item.evidenceRef=`evidence://${item.id}`});
  const payload={confirmation:"CONFIRM EMERGENCY CUTOVER APPROVAL",evidenceRef:"evidence://cutover/business",note:"business approved"};
  Production.signCutoverApproval(data,{role:"commission",name:"业务负责人"},"emg-approval-business",payload);
  assert.throws(()=>Production.signCutoverApproval(data,{role:"commission",name:"业务负责人"},"emg-approval-technical",{...payload,evidenceRef:"evidence://cutover/technical"}),/different signers/);
  Production.signCutoverApproval(data,{role:"commission",name:"技术负责人"},"emg-approval-technical",{...payload,evidenceRef:"evidence://cutover/technical"});
  assert.equal(Production.buildCenter(data).productionReady,true);
});

test("production handoffs, observation windows and launch incidents are evidence backed", () => {
  const data=Production.seed();
  const handoff=Production.acceptProductionHandoff(data,commission,"emg-handoff-command",{confirmation:"ACCEPT EMERGENCY PRODUCTION HANDOFF",evidenceRef:"evidence://handoff/command"});
  assert.equal(handoff.status,"accepted");
  assert.equal(Production.acceptProductionHandoff(data,commission,"emg-handoff-command",{}).id,handoff.id);
  const observation=Production.recordObservation(data,commission,"emg-observe-0-2h",{result:"passed",evidenceRef:"evidence://observe/0-2h"});assert.equal(observation.status,"passed");
  const incident=Production.createLaunchIncident(data,commission,{title:"调度回执超时",severity:"P0",note:"trigger rollback review"});assert.equal(incident.rollbackRecommended,true);assert.equal(Production.buildCenter(data).summary.openLaunchIncidents,1);
  Production.resolveLaunchIncident(data,commission,incident.id,{note:"链路恢复并完成对账",evidenceRef:"evidence://incident/resolved"});assert.equal(Production.buildCenter(data).summary.openLaunchIncidents,0);
});
