const test = require("node:test");
const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const Gateway = require("../emergency-device-gateway");

const submitter = { role:"commission", name:"设备验收提交人" };
const verifier = { role:"commission", name:"独立复核人" };
const secret = "site-secret-reference-value-2026";
const evidenceDigest = "a".repeat(64);

function activeFixture() {
  const data = Gateway.seed();
  const device = Gateway.registerDevice(data, submitter, {
    deviceId:"ambulance-monitor-001", vendor:"设备厂商", model:"ECG-X", serialNo:"SN-001",
    ownerOrganization:"120急救中心", credentialRef:"vault://emergency/device/SN-001",
    certificateFingerprint:"b".repeat(64), allowedSignals:["cardiac-risk","fall-risk"]
  }, { now:"2026-07-22T06:00:00.000Z" });
  Gateway.submitAttestation(data, submitter, device.id, {
    evidenceRef:"evidence://device/SN-001", evidenceDigest,
    externalSigner:"厂商现场工程师", externalOrganization:"设备厂商"
  }, { now:"2026-07-22T06:01:00.000Z" });
  Gateway.verifyAttestation(data, verifier, device.id, {
    confirmation:Gateway.ATTESTATION_CONFIRMATION, evidenceDigest,
    verificationRef:"verification://commission/SN-001"
  }, { now:"2026-07-22T06:02:00.000Z" });
  return { data, device };
}

function signedPayload(overrides = {}) {
  const payload = {
    deviceId:"ambulance-monitor-001", signal:"cardiac-risk", riskScore:88,
    sourceSignalId:"signal-001", occurredAt:"2026-07-22T06:03:00.000Z",
    counter:1, residentId:"resident-001", ...overrides
  };
  payload.signature = createHmac("sha256", secret).update(Gateway.canonicalSignal(payload)).digest("hex");
  return payload;
}

test("device registration persists only references and requires independent attestation verification", () => {
  const data = Gateway.seed();
  assert.throws(()=>Gateway.registerDevice(data, submitter, { deviceId:"bad", vendor:"v", model:"m", serialNo:"s", credentialRef:"vault://x", certificateFingerprint:"b".repeat(64), allowedSignals:["fall-risk"], secret:"must-not-store" }), /must not be persisted/);
  const fixture = activeFixture();
  const { device } = fixture;
  assert.equal(device.status, "active");
  assert.equal("secret" in device, false);
  assert.equal(device.attestation.verifiedBy, verifier.name);
  assert.equal(Gateway.center(fixture.data).summary.activeDevices, 1);
});

test("attestation cannot be verified by its submitter or with a changed digest", () => {
  const data = Gateway.seed();
  const device = Gateway.registerDevice(data, submitter, { deviceId:"d-2", vendor:"v", model:"m", serialNo:"s-2", credentialRef:"vault://d-2", certificateFingerprint:"c".repeat(64), allowedSignals:["fall-risk"] });
  Gateway.submitAttestation(data, submitter, device.id, { evidenceRef:"evidence://d-2", evidenceDigest, externalSigner:"vendor", externalOrganization:"vendor-org" });
  assert.throws(()=>Gateway.verifyAttestation(data, submitter, device.id, { confirmation:Gateway.ATTESTATION_CONFIRMATION, evidenceDigest, verificationRef:"same-user" }), /independent verifier/);
  assert.throws(()=>Gateway.verifyAttestation(data, verifier, device.id, { confirmation:Gateway.ATTESTATION_CONFIRMATION, evidenceDigest:"d".repeat(64), verificationRef:"changed" }), /submitted digest/);
});

test("signed signals require active identity, HMAC, fresh clock and monotonic counter", () => {
  const { data } = activeFixture();
  const options = { now:"2026-07-22T06:03:30.000Z", secretResolver:(ref)=>ref.startsWith("vault://") ? secret : "" };
  const accepted = Gateway.receiveSignedSignal(data, signedPayload(), options);
  assert.equal(accepted.signatureVerified, true);
  assert.equal(accepted.deviceAttestationDigest, evidenceDigest);
  assert.equal(data.emergencyTrustedDevices[0].lastCounter, 1);
  const invalidSignature = signedPayload({ sourceSignalId:"signal-bad", counter:2 });
  invalidSignature.signature = "0".repeat(64);
  assert.throws(()=>Gateway.receiveSignedSignal(data, invalidSignature, options), /signature is invalid/);
  assert.throws(()=>Gateway.receiveSignedSignal(data, signedPayload({ sourceSignalId:"signal-old", occurredAt:"2026-07-22T05:00:00.000Z", counter:2 }), options), /clock window/);
  assert.throws(()=>Gateway.receiveSignedSignal(data, signedPayload({ sourceSignalId:"signal-counter", counter:1 }), options), /not monotonic/);
});

test("same signed source signal is idempotent but changed replay is rejected", () => {
  const { data } = activeFixture();
  const options = { now:"2026-07-22T06:03:30.000Z", secretResolver:()=>secret };
  const payload = signedPayload();
  const first = Gateway.receiveSignedSignal(data, payload, options);
  const replay = Gateway.receiveSignedSignal(data, payload, options);
  assert.equal(replay.id, first.id);
  assert.equal(replay.idempotentReplay, true);
  assert.throws(()=>Gateway.receiveSignedSignal(data, { ...payload, signature:"0".repeat(64) }, options), /signature is invalid/);
  assert.throws(()=>Gateway.receiveSignedSignal(data, signedPayload({ riskScore:89 }), options), /reused with different content/);
  assert.equal(data.emergencyDeviceSignals.length, 1);
});

test("T00 route contract covers read, registration, evidence and signal ingestion", () => {
  assert.equal(Gateway.ROUTE_CONTRACTS.length, 6);
  assert.ok(Gateway.ROUTE_CONTRACTS.every((route)=>route.path.startsWith("/api/emergency/device-gateway")));
  assert.ok(Gateway.ROUTE_CONTRACTS.some((route)=>route.handler.endsWith("receiveSignedSignal")));
});

test("device suspension, retirement and credential rotation preserve a controlled lifecycle", () => {
  const rotated = activeFixture();
  Gateway.manageDevice(rotated.data, verifier, rotated.device.id, { action:"rotate-credential", confirmation:Gateway.DEVICE_CONTROL_CONFIRMATION, evidenceRef:"change://credential/001", credentialRef:"vault://emergency/device/SN-001/v2", certificateFingerprint:"d".repeat(64) });
  assert.equal(rotated.device.status, "attestation-pending");
  assert.equal(rotated.device.attestation, null);
  assert.throws(()=>Gateway.receiveSignedSignal(rotated.data, signedPayload(), { now:"2026-07-22T06:03:30.000Z", secretResolver:()=>secret }), /attestation is not active/);

  const suspended = activeFixture();
  Gateway.manageDevice(suspended.data, verifier, suspended.device.id, { action:"suspend", confirmation:Gateway.DEVICE_CONTROL_CONFIRMATION, evidenceRef:"incident://device/001" });
  assert.equal(suspended.device.status, "suspended");
  assert.throws(()=>Gateway.receiveSignedSignal(suspended.data, signedPayload(), { now:"2026-07-22T06:03:30.000Z", secretResolver:()=>secret }), /attestation is not active/);
  Gateway.manageDevice(suspended.data, verifier, suspended.device.id, { action:"retire", confirmation:Gateway.DEVICE_CONTROL_CONFIRMATION, evidenceRef:"asset://retire/001" });
  assert.equal(suspended.device.status, "retired");
  assert.throws(()=>Gateway.submitAttestation(suspended.data, submitter, suspended.device.id, { evidenceRef:"e", evidenceDigest, externalSigner:"x", externalOrganization:"y" }), /not eligible/);
});
