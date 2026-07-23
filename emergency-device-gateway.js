const { createHash, createHmac, randomUUID, timingSafeEqual } = require("node:crypto");

const ATTESTATION_CONFIRMATION = "VERIFY EMERGENCY DEVICE ATTESTATION";
const DEVICE_CONTROL_CONFIRMATION = "CONFIRM EMERGENCY DEVICE CONTROL";
const DEFAULT_MAX_SIGNAL_AGE_SECONDS = 120;

const ROUTE_CONTRACTS = Object.freeze([
  { method:"GET", path:"/api/emergency/device-gateway", roles:["commission","institution"], handler:"EmergencyDeviceGateway.center" },
  { method:"POST", path:"/api/emergency/device-gateway/devices", roles:["commission"], handler:"EmergencyDeviceGateway.registerDevice" },
  { method:"POST", path:"/api/emergency/device-gateway/devices/:id/attestation/submit", roles:["commission"], handler:"EmergencyDeviceGateway.submitAttestation" },
  { method:"POST", path:"/api/emergency/device-gateway/devices/:id/attestation/verify", roles:["commission"], handler:"EmergencyDeviceGateway.verifyAttestation" },
  { method:"POST", path:"/api/emergency/device-gateway/devices/:id/actions", roles:["commission"], handler:"EmergencyDeviceGateway.manageDevice" },
  { method:"POST", path:"/api/emergency/device-gateway/signals", roles:["integration"], handler:"EmergencyDeviceGateway.receiveSignedSignal" }
]);

function now(options = {}) { return options.now || new Date().toISOString(); }
function clean(value, max = 300) { return String(value || "").trim().slice(0, max); }
function digest(value) { return createHash("sha256").update(String(value)).digest("hex"); }
function actor(user = {}) { return clean(user.name || user.username || user.id, 100); }
function fail(message, status = 400) { throw Object.assign(new Error(message), { status, statusCode:status }); }
function requireCommission(user) { if (user?.role !== "commission") fail("commission role is required", 403); }
function validSha256(value) { return /^[a-f0-9]{64}$/i.test(clean(value, 64)); }

function seed() {
  return {
    emergencyTrustedDevices: [],
    emergencyDeviceSignals: [],
    emergencyDeviceGatewayAudit: []
  };
}

function ensure(data) {
  for (const [key, value] of Object.entries(seed())) if (!Array.isArray(data[key])) data[key] = value;
  return data;
}

function audit(data, user, action, target, detail, options = {}) {
  const row = {
    id:randomUUID(),
    at:now(options),
    actor:actor(user) || "integration-gateway",
    role:clean(user?.role || "integration", 30),
    action,
    target,
    detail:clean(detail, 500),
    previousDigest:data.emergencyDeviceGatewayAudit[0]?.digest || "GENESIS"
  };
  row.digest = digest(JSON.stringify(row));
  data.emergencyDeviceGatewayAudit.unshift(row);
  data.emergencyDeviceGatewayAudit = data.emergencyDeviceGatewayAudit.slice(0, 2000);
  return row;
}

function registerDevice(data, user, payload = {}, options = {}) {
  ensure(data);
  requireCommission(user);
  const deviceId = clean(payload.deviceId, 100);
  const credentialRef = clean(payload.credentialRef, 200);
  const certificateFingerprint = clean(payload.certificateFingerprint, 64).toLowerCase();
  const allowedSignals = [...new Set((Array.isArray(payload.allowedSignals) ? payload.allowedSignals : []).map((item)=>clean(item, 50)).filter(Boolean))];
  if (!deviceId || !clean(payload.vendor) || !clean(payload.model) || !clean(payload.serialNo)) fail("deviceId, vendor, model and serialNo are required");
  if (!credentialRef || !validSha256(certificateFingerprint)) fail("credentialRef and SHA-256 certificateFingerprint are required");
  if (!allowedSignals.length) fail("at least one allowed signal is required");
  if (payload.secret || payload.key || payload.credential) fail("raw device secrets must not be persisted");
  if (data.emergencyTrustedDevices.some((item)=>item.deviceId === deviceId || item.serialNo === clean(payload.serialNo))) fail("device identity already exists", 409);
  const createdAt = now(options);
  const device = {
    id:`emg-device-${randomUUID()}`,
    deviceId,
    vendor:clean(payload.vendor, 100),
    model:clean(payload.model, 100),
    serialNo:clean(payload.serialNo, 100),
    ownerOrganization:clean(payload.ownerOrganization, 150),
    credentialRef,
    certificateFingerprint,
    allowedSignals,
    status:"attestation-pending",
    attestation:null,
    lastCounter:0,
    lastSignalAt:"",
    createdAt,
    createdBy:actor(user)
  };
  data.emergencyTrustedDevices.unshift(device);
  audit(data, user, "register-device", device.id, `${device.deviceId}; ${device.credentialRef}`, options);
  return device;
}

function submitAttestation(data, user, id, payload = {}, options = {}) {
  ensure(data);
  requireCommission(user);
  const device = data.emergencyTrustedDevices.find((item)=>item.id === id);
  if (!device) fail("trusted device not found", 404);
  if (!["attestation-pending", "suspended"].includes(device.status)) fail("device is not eligible for attestation submission", 409);
  const evidenceRef = clean(payload.evidenceRef, 300);
  const evidenceDigest = clean(payload.evidenceDigest, 64).toLowerCase();
  const externalSigner = clean(payload.externalSigner, 100);
  const externalOrganization = clean(payload.externalOrganization, 150);
  if (!evidenceRef || !validSha256(evidenceDigest) || !externalSigner || !externalOrganization) fail("external signer, organization, evidenceRef and SHA-256 evidenceDigest are required");
  device.attestation = {
    evidenceRef,
    evidenceDigest,
    externalSigner,
    externalOrganization,
    submittedBy:actor(user),
    submittedAt:now(options),
    verifiedBy:"",
    verifiedAt:"",
    verificationRef:""
  };
  device.status = "attestation-submitted";
  audit(data, user, "submit-device-attestation", id, `${externalOrganization}; ${evidenceRef}; sha256:${evidenceDigest}`, options);
  return device;
}

function manageDevice(data, user, id, payload = {}, options = {}) {
  ensure(data);
  requireCommission(user);
  const device = data.emergencyTrustedDevices.find((item)=>item.id === id);
  if (!device) fail("trusted device not found", 404);
  const action = clean(payload.action, 40);
  const evidenceRef = clean(payload.evidenceRef, 300);
  if (clean(payload.confirmation, 100) !== DEVICE_CONTROL_CONFIRMATION || !evidenceRef) fail("exact device control confirmation and evidenceRef are required");
  if (action === "suspend") {
    if (device.status !== "active") fail("only an active device can be suspended", 409);
    device.status = "suspended";
  } else if (action === "retire") {
    if (device.status === "retired") fail("device is already retired", 409);
    device.status = "retired";
  } else if (action === "rotate-credential") {
    if (!["active", "suspended"].includes(device.status)) fail("credential rotation requires an active or suspended device", 409);
    const credentialRef = clean(payload.credentialRef, 200);
    const certificateFingerprint = clean(payload.certificateFingerprint, 64).toLowerCase();
    if (!credentialRef || !validSha256(certificateFingerprint)) fail("new credentialRef and SHA-256 certificateFingerprint are required");
    if (payload.secret || payload.key || payload.credential) fail("raw device secrets must not be persisted");
    device.credentialRef = credentialRef;
    device.certificateFingerprint = certificateFingerprint;
    device.attestation = null;
    device.lastCounter = 0;
    device.status = "attestation-pending";
  } else {
    fail("device action must be suspend, retire or rotate-credential");
  }
  device.updatedAt = now(options);
  device.updatedBy = actor(user);
  device.controlEvidenceRef = evidenceRef;
  audit(data, user, `device-${action}`, id, evidenceRef, options);
  return device;
}

function verifyAttestation(data, user, id, payload = {}, options = {}) {
  ensure(data);
  requireCommission(user);
  const device = data.emergencyTrustedDevices.find((item)=>item.id === id);
  if (!device) fail("trusted device not found", 404);
  if (device.status === "active") return device;
  if (!device.attestation || device.status !== "attestation-submitted") fail("attestation evidence must be submitted first", 409);
  const verifier = actor(user);
  const evidenceDigest = clean(payload.evidenceDigest, 64).toLowerCase();
  const verificationRef = clean(payload.verificationRef, 300);
  if (clean(payload.confirmation, 100) !== ATTESTATION_CONFIRMATION) fail("exact attestation confirmation is required");
  if (!verifier || verifier === device.attestation.submittedBy || verifier === device.attestation.externalSigner) fail("attestation requires an independent verifier", 409);
  if (evidenceDigest !== device.attestation.evidenceDigest || !verificationRef) fail("verification must use the submitted digest and an independent reference");
  device.attestation.verifiedBy = verifier;
  device.attestation.verifiedAt = now(options);
  device.attestation.verificationRef = verificationRef;
  device.status = "active";
  audit(data, user, "verify-device-attestation", id, `${verificationRef}; sha256:${evidenceDigest}`, options);
  return device;
}

function canonicalSignal(payload = {}) {
  return JSON.stringify({
    deviceId:clean(payload.deviceId, 100),
    signal:clean(payload.signal, 50),
    riskScore:Number(payload.riskScore),
    sourceSignalId:clean(payload.sourceSignalId, 150),
    occurredAt:clean(payload.occurredAt, 40),
    counter:Number(payload.counter),
    residentId:clean(payload.residentId, 100)
  });
}

function signaturesEqual(actual, expected) {
  if (!/^[a-f0-9]{64}$/i.test(actual) || !/^[a-f0-9]{64}$/i.test(expected)) return false;
  return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

function receiveSignedSignal(data, payload = {}, options = {}) {
  ensure(data);
  const device = data.emergencyTrustedDevices.find((item)=>item.deviceId === clean(payload.deviceId, 100));
  if (!device) fail("trusted device not found", 404);
  if (device.status !== "active") fail("device attestation is not active", 409);
  if (!device.allowedSignals.includes(clean(payload.signal, 50))) fail("signal is not allowed for this device", 403);
  const sourceSignalId = clean(payload.sourceSignalId, 150);
  const occurredAt = new Date(payload.occurredAt || "");
  const counter = Number(payload.counter);
  const riskScore = Number(payload.riskScore);
  if (!sourceSignalId || Number.isNaN(occurredAt.getTime()) || !Number.isInteger(counter) || counter <= 0 || !Number.isFinite(riskScore) || riskScore < 0 || riskScore > 100) fail("sourceSignalId, occurredAt, positive counter and riskScore 0-100 are required");
  const canonical = canonicalSignal(payload);
  const payloadDigest = digest(canonical);
  const replay = data.emergencyDeviceSignals.find((item)=>item.deviceId === device.deviceId && item.sourceSignalId === sourceSignalId);
  if (replay && replay.payloadDigest !== payloadDigest) fail("sourceSignalId was reused with different content", 409);
  if (typeof options.secretResolver !== "function") fail("device secret resolver is not configured", 503);
  const secret = options.secretResolver(device.credentialRef);
  if (!secret || String(secret).length < 16) fail("device credential is unavailable", 503);
  const expected = createHmac("sha256", secret).update(canonical).digest("hex");
  const signature = clean(payload.signature, 64).toLowerCase();
  if (!signaturesEqual(signature, expected)) fail("device signal signature is invalid", 401);
  if (replay) return { ...replay, idempotentReplay:true };
  const receivedAt = new Date(now(options));
  const maxAgeSeconds = Number(options.maxSignalAgeSeconds || DEFAULT_MAX_SIGNAL_AGE_SECONDS);
  if (Number.isNaN(receivedAt.getTime()) || Math.abs(receivedAt - occurredAt) > maxAgeSeconds * 1000) fail("device signal is outside the accepted clock window", 409);
  if (counter <= Number(device.lastCounter || 0)) fail("device signal counter is not monotonic", 409);
  const record = {
    id:`emg-signal-${randomUUID()}`,
    deviceId:device.deviceId,
    trustedDeviceId:device.id,
    deviceAttestationDigest:device.attestation.evidenceDigest,
    sourceSignalId,
    signal:clean(payload.signal, 50),
    riskScore,
    residentId:clean(payload.residentId, 100),
    occurredAt:occurredAt.toISOString(),
    receivedAt:receivedAt.toISOString(),
    counter,
    payloadDigest,
    signatureDigest:digest(signature),
    signatureVerified:true,
    idempotentReplay:false
  };
  data.emergencyDeviceSignals.unshift(record);
  data.emergencyDeviceSignals = data.emergencyDeviceSignals.slice(0, 5000);
  device.lastCounter = counter;
  device.lastSignalAt = record.receivedAt;
  audit(data, { role:"integration", name:device.deviceId }, "accept-signed-device-signal", record.id, `${sourceSignalId}; ${payloadDigest}`, options);
  return record;
}

function center(data) {
  ensure(data);
  const active = data.emergencyTrustedDevices.filter((item)=>item.status === "active");
  const pending = data.emergencyTrustedDevices.filter((item)=>["attestation-pending", "attestation-submitted"].includes(item.status));
  return {
    generatedAt:new Date().toISOString(),
    formalGoLiveState:active.length ? "device-gateway-ready" : data.emergencyTrustedDevices.length ? "blocked-until-device-attestation-verified" : "blocked-until-device-registered",
    summary:{
      devices:data.emergencyTrustedDevices.length,
      activeDevices:active.length,
      pendingAttestations:pending.length,
      suspendedDevices:data.emergencyTrustedDevices.filter((item)=>item.status === "suspended").length,
      retiredDevices:data.emergencyTrustedDevices.filter((item)=>item.status === "retired").length,
      acceptedSignals:data.emergencyDeviceSignals.length,
      verifiedSignals:data.emergencyDeviceSignals.filter((item)=>item.signatureVerified).length
    },
    devices:data.emergencyTrustedDevices,
    signals:data.emergencyDeviceSignals.slice(0, 100),
    audit:data.emergencyDeviceGatewayAudit.slice(0, 100),
    routeContracts:ROUTE_CONTRACTS,
    security:{ algorithm:"HMAC-SHA256", maxSignalAgeSeconds:DEFAULT_MAX_SIGNAL_AGE_SECONDS, rawSecretsPersisted:false, replayControls:["sourceSignalId-idempotency","monotonic-device-counter","clock-window"] }
  };
}

module.exports = {
  ATTESTATION_CONFIRMATION,
  DEFAULT_MAX_SIGNAL_AGE_SECONDS,
  DEVICE_CONTROL_CONFIRMATION,
  ROUTE_CONTRACTS,
  canonicalSignal,
  center,
  ensure,
  manageDevice,
  receiveSignedSignal,
  registerDevice,
  seed,
  submitAttestation,
  verifyAttestation
};
