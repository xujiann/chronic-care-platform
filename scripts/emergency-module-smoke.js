const EmergencyService = require("../emergency-service");
const DeviceGateway = require("../emergency-device-gateway");
const Production = require("../emergency-production");
const Gate = require("../emergency-module-gate");

function run() {
  const data = { ...EmergencyService.seed(), ...Production.seed(), ...DeviceGateway.seed() };
  const handover = Gate.runHandoverAcceptanceScenario();
  const readiness = Gate.buildIndependentModuleReadiness(data);
  const dispatchEnvelope = DeviceGateway.validateIntegrationEnvelope("120-dispatch-receipt", {
    receiptId:"smoke-dispatch-001", eventId:"smoke-event-001", correlationId:"120-correlation-001", occurredAt:new Date().toISOString(), decision:"accepted", signature:"detached-jws", signatureAlgorithm:"JWS-ES256"
  }, { mtlsPeer:{ verified:true, certificateFingerprint:"c".repeat(64) }, signatureVerifier:()=>true });
  const report = { ok:handover.status === "passed" && dispatchEnvelope.contractId === "120-dispatch-receipt", moduleId:Gate.MODULE_ID, handover, dispatchEnvelope, readiness, formalGoLiveState:readiness.formalGoLiveState, releaseDecision:readiness.formalGoLiveState === "ready-for-production" ? "go-with-site-command" : "no-go-site-evidence-pending" };
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

if (require.main === module) run();
module.exports = { run };
